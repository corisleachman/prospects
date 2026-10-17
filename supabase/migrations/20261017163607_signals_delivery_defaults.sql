begin;
alter table public.workspaces add column default_max_cards_per_day integer not null default 10 check(default_max_cards_per_day between 1 and 100);
alter table public.workspaces add column default_no_repeat_days integer not null default 30 check(default_no_repeat_days between 1 and 365);
alter table public.workspaces add column delivery_limits_revision integer not null default 0;
alter table public.delivery_rules add column max_cards_override integer check(max_cards_override between 1 and 100);
alter table public.delivery_rules add column repeat_days_override integer check(repeat_days_override between 1 and 365);
update public.delivery_rules set max_cards_override=case when max_cards_per_day<>10 then max_cards_per_day end,repeat_days_override=case when no_repeat_days<>30 then no_repeat_days end;
create function private.inherit_signals_delivery_limits() returns trigger language plpgsql security definer set search_path='' as $$begin
 select coalesce(new.max_cards_override,default_max_cards_per_day),coalesce(new.repeat_days_override,default_no_repeat_days) into new.max_cards_per_day,new.no_repeat_days from public.workspaces where id=new.workspace_id;return new;end;$$;
revoke all on function private.inherit_signals_delivery_limits() from public,anon,authenticated;
create trigger inherit_signals_delivery_limits before insert on public.delivery_rules for each row execute function private.inherit_signals_delivery_limits();
create function private.save_signals_delivery_limits(p_workspace uuid,p_revision integer,p_daily integer,p_repeat integer) returns jsonb language plpgsql security definer set search_path='' as $$declare revision integer;begin
 perform private.require_signals_setup_admin(p_workspace);
 update public.workspaces set default_max_cards_per_day=p_daily,default_no_repeat_days=p_repeat,delivery_limits_revision=delivery_limits_revision+1 where id=p_workspace and delivery_limits_revision=p_revision returning delivery_limits_revision into revision;
 if not found then raise exception 'Client limits changed elsewhere. Reload before saving.' using errcode='40001';end if;
 update public.delivery_rules set max_cards_per_day=coalesce(max_cards_override,p_daily),no_repeat_days=coalesce(repeat_days_override,p_repeat),setup_revision=setup_revision+1 where workspace_id=p_workspace and (max_cards_per_day is distinct from coalesce(max_cards_override,p_daily) or no_repeat_days is distinct from coalesce(repeat_days_override,p_repeat));
 return jsonb_build_object('revision',revision,'routes',(select coalesce(jsonb_agg(d),'[]') from public.delivery_rules d where workspace_id=p_workspace));end;$$;
create function public.save_signals_delivery_limits(p_workspace uuid,p_revision integer,p_daily integer,p_repeat integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_signals_delivery_limits(p_workspace,p_revision,p_daily,p_repeat);$$;
revoke all on function private.save_signals_delivery_limits(uuid,integer,integer,integer),public.save_signals_delivery_limits(uuid,integer,integer,integer) from public,anon;
grant execute on function private.save_signals_delivery_limits(uuid,integer,integer,integer),public.save_signals_delivery_limits(uuid,integer,integer,integer) to authenticated;
create or replace function private.save_signals_delivery(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.delivery_rules;vrole text;daily integer;repeat_days integer;default_daily integer;default_repeat integer;begin
 perform private.require_signals_setup_admin(p_workspace);
 select * into r from public.delivery_rules where workspace_id=p_workspace and id=p_id for update;
 if r.id is null or r.setup_revision<>p_revision then raise exception 'Person changed elsewhere. Reload before saving.' using errcode='40001';end if;
 select default_max_cards_per_day,default_no_repeat_days into default_daily,default_repeat from public.workspaces where id=p_workspace;
 daily:=case when p_value?'max_cards_override' then nullif(p_value->>'max_cards_override','')::integer else case when coalesce((p_value->>'max_cards_per_day')::integer,default_daily)<>default_daily then (p_value->>'max_cards_per_day')::integer end end;
 repeat_days:=case when p_value?'repeat_days_override' then nullif(p_value->>'repeat_days_override','')::integer else case when coalesce((p_value->>'no_repeat_days')::integer,default_repeat)<>default_repeat then (p_value->>'no_repeat_days')::integer end end;
 vrole:=p_value->>'role';if vrole not in ('client_admin','client_user') or vrole is null then raise exception 'Choose a client role';end if;
 if length(coalesce(p_value->>'display_name',''))>120 then raise exception 'Name is too long';end if;
 if r.user_id is not null then
 update public.workspace_members set display_name=coalesce(p_value->>'display_name',display_name),role=vrole where workspace_id=p_workspace and user_id=r.user_id and status='active';
 if not found then raise exception 'Membership unavailable';end if;
 else update public.workspace_invites set display_name=coalesce(p_value->>'display_name',display_name),role=vrole where id=r.invite_id and workspace_id=p_workspace and accepted_at is null and revoked_at is null and expires_at>now();if not found then raise exception 'Invitation unavailable';end if;end if;
 update public.delivery_rules set profile_ids=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_value->'profile_ids','[]'))),max_cards_override=daily,repeat_days_override=repeat_days,max_cards_per_day=coalesce(daily,default_daily),no_repeat_days=coalesce(repeat_days,default_repeat),morning_email_time=nullif(p_value->>'morning_email_time','')::time,setup_revision=setup_revision+1 where id=r.id returning * into r;return to_jsonb(r);end;$$;
commit;
