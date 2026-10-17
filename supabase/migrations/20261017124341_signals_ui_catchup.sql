begin;
alter table public.workspaces add column website text not null default '' check(website='' or (website ~ '^https://' and length(website)<=2000));
alter table public.workspaces add column client_type text not null default '' check(client_type in ('','Ad agency','Consultancy','Consumer brand','Software business','Other'));
alter table public.campaigns add column code text not null default '' check(code='' or code ~ '^[A-Z0-9]{1,8}$');
with ranked as (select c.id,row_number() over(partition by c.workspace_id order by c.created_at,c.id) as n from public.campaigns c join public.workspaces w on w.id=c.workspace_id where w.is_signals_client)
update public.campaigns c set code=lpad(r.n::text,greatest(2,length(r.n::text)),'0') from ranked r where c.id=r.id;
create unique index campaigns_workspace_code on public.campaigns(workspace_id,code) where code<>'' and status<>'archived';
create function private.default_signals_profile_code() returns trigger language plpgsql security definer set search_path='' as $$declare n integer:=1;begin
 if new.code='' and exists(select 1 from public.workspaces where id=new.workspace_id and is_signals_client) then
 perform 1 from public.workspaces where id=new.workspace_id for update;
 while exists(select 1 from public.campaigns where workspace_id=new.workspace_id and code=lpad(n::text,greatest(2,length(n::text)),'0') and status<>'archived') loop n:=n+1;end loop;
 new.code:=lpad(n::text,greatest(2,length(n::text)),'0');end if;return new;end;$$;
revoke all on function private.default_signals_profile_code() from public,anon,authenticated;
create trigger default_signals_profile_code before insert on public.campaigns for each row execute function private.default_signals_profile_code();
create or replace function private.save_signals_profile(p_workspace_id uuid,p_id uuid,p_revision integer,p_profile jsonb) returns integer
 language plpgsql security definer set search_path='' as $$
 declare result integer; begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
 perform 1 from public.workspaces where id=p_workspace_id and is_signals_client and status<>'archived' for update;
 if not found then raise exception 'Client unavailable'; end if;
 if length(trim(coalesce(p_profile->>'name',''))) not between 1 and 120 then raise exception 'Enter a profile name'; end if;
 if octet_length(p_profile::text)>100000 then raise exception 'Profile is too long'; end if;
 if p_id is null then
 insert into public.campaigns(workspace_id,name) values(p_workspace_id,trim(p_profile->>'name')) returning id into p_id;
 p_revision:=0;
 end if;
 update public.campaigns set code=upper(trim(coalesce(p_profile->>'code',code))),name=trim(p_profile->>'name'),profile_type=coalesce(p_profile->>'profile_type','cold_outbound'),
 who=coalesce(p_profile->>'who',''),criteria=coalesce(p_profile->'criteria','{}'),
 priority_titles=array(select jsonb_array_elements_text(coalesce(p_profile->'priority_titles','[]'))),
 relevant_moment=coalesce(p_profile->>'relevant_moment',''),conversation_to_open=coalesce(p_profile->>'conversation_to_open',''),
 watch_list_size=coalesce((p_profile->>'watch_list_size')::integer,200),when_no_person=coalesce(p_profile->>'when_no_person','needs_person'),setup_revision=setup_revision+1
 where id=p_id and workspace_id=p_workspace_id and status<>'archived' and setup_revision=p_revision returning setup_revision into result;
 if not found then raise exception 'Profile changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 return result; end; $$;

create or replace function private.save_signals_watchlist(p_id uuid,p_company_keys jsonb,p_person_keys jsonb) returns integer language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;c jsonb;person jsonb;cid uuid;pid uuid;company_ids jsonb:='{}';n integer:=0;limit_n integer;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.discovery_previews where id=p_id) for update;
 select * into p from public.discovery_previews where id=p_id for update;
 if p.id is null or p.status not in ('succeeded','partial') then raise exception 'Completed preview required';end if;
 select watch_list_size into limit_n from public.campaigns where id=p.profile_id and workspace_id=p.workspace_id and setup_revision=p.profile_revision;
 if not found then raise exception 'Profile changed. Find matches again.';end if;
 if not exists(select 1 from public.campaigns where id=p.profile_id and watch_revision=coalesce((p.plan->>'saved_watch_revision')::integer,(p.plan->'profile'->>'watch_revision')::integer,0)) then raise exception 'Watch list changed. Find matches again.';end if;
 if p.kind='refresh' and not exists(select 1 from public.campaigns where id=p.profile_id and watch_refresh_enabled) then raise exception 'Weekly refresh is disabled';end if;
 if jsonb_typeof(p_company_keys)<>'array' or jsonb_typeof(p_person_keys)<>'array' or p_company_keys is null or p_person_keys is null then raise exception 'Choose companies and people';end if;
 if jsonb_array_length(p_company_keys)>limit_n then raise exception 'Watch-list size exceeded';end if;
 if exists(select 1 from jsonb_array_elements_text(p_company_keys) k where not exists(select 1 from jsonb_array_elements(p.result->'companies') x where x->>'key'=k)) or exists(select 1 from jsonb_array_elements_text(p_person_keys) k where not exists(select 1 from jsonb_array_elements(p.result->'people') x where x->>'key'=k)) then raise exception 'Selection outside this preview';end if;
 -- Only V2 rows for this exact profile are replaced. CRM watch lists stay intact.
 delete from public.campaign_prospects where campaign_id=p.profile_id and workspace_id=p.workspace_id and company_id is not null;
 for c in select value from jsonb_array_elements(p.result->'companies') where p_company_keys ? (value->>'key') loop
 select id into cid from public.companies where discovery_key=c->>'key' or (nullif(c->>'domain','') is not null and lower(domain)=lower(c->>'domain')) limit 1;
 if cid is not null then update public.companies set name=c->>'name',website=coalesce(nullif(c->>'website',''),website),linkedin_url=coalesce(nullif(c->>'linkedin_url',''),linkedin_url),discovery_key=coalesce(discovery_key,c->>'key'),revenue_range=case when coalesce(c->>'revenue_band','')<>'' then jsonb_build_object('label',c->>'revenue_band') else revenue_range end,headcount_range=case when coalesce(c->>'headcount_band','')<>'' then jsonb_build_object('label',c->>'headcount_band') else headcount_range end,updated_at=now() where id=cid;
 else
 insert into public.companies(workspace_id,name,website,domain,linkedin_url,industry,location,revenue_range,headcount_range,provider_ids,discovery_key)
 values(p.workspace_id,c->>'name',nullif(c->>'website',''),nullif(c->>'domain',''),nullif(c->>'linkedin_url',''),c->>'industry',c->>'location',jsonb_build_object('label',c->>'revenue_band'),jsonb_build_object('label',c->>'headcount_band'),coalesce(c->'provider_ids','{}'),c->>'key')
 on conflict(discovery_key) do update set name=excluded.name,website=coalesce(excluded.website,public.companies.website),linkedin_url=coalesce(excluded.linkedin_url,public.companies.linkedin_url),updated_at=now() returning id into cid;
 end if;
 company_ids:=company_ids||jsonb_build_object(c->>'key',cid);
 insert into public.campaign_prospects(workspace_id,campaign_id,company_id,source,group_type,last_refreshed_at) values(p.workspace_id,p.profile_id,cid,coalesce(c->>'source','discovered'),'watchlist',now());n:=n+1;
 end loop;
 for person in select value from jsonb_array_elements(p.result->'people') where p_person_keys ? (value->>'key') loop
 cid:=(company_ids->>(person->>'company_key'))::uuid;
 if cid is null then raise exception 'Select the person’s company too';end if;
 insert into public.people(workspace_id,name,title,company_id,linkedin_url,location,provider_ids,last_checked_at,discovery_key)
 values(p.workspace_id,person->>'name',person->>'title',cid,person->>'linkedin_url',person->>'location',coalesce(person->'provider_ids','{}'),now(),person->>'key')
 on conflict(discovery_key) do update set name=excluded.name,title=excluded.title,company_id=excluded.company_id,last_checked_at=now() returning id into pid;
 insert into public.campaign_prospects(workspace_id,campaign_id,company_id,person_id,source,group_type,last_refreshed_at) values(p.workspace_id,p.profile_id,cid,pid,'discovered','watchlist',now());
 end loop;
 if p.kind='find' then update public.campaigns set watch_exclusions=(select coalesce(jsonb_agg(x->>'key'),'[]') from jsonb_array_elements((p.result->'companies')||(p.result->'people')) x where not(p_company_keys ? (x->>'key')) and not(p_person_keys ? (x->>'key'))) where id=p.profile_id;end if;
 update public.campaigns set watch_revision=watch_revision+1 where id=p.profile_id;
 update public.discovery_previews set saved_at=now(),plan=plan||jsonb_build_object('saved_watch_revision',(select watch_revision from public.campaigns where id=p.profile_id)) where id=p.id;
 update public.campaigns set next_watch_refresh_at=case when watch_refresh_enabled then now()+interval '7 days' else null end where id=p.profile_id;
 return n;end;$$;
create function public.signals_admin_month_spend() returns numeric language sql stable security invoker set search_path='' as $$
 select case when private.is_platform_admin() then (select coalesce(sum(cost),0) from public.cost_ledger where not is_test and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') else null end;$$;
revoke all on function public.signals_admin_month_spend() from public,anon;
grant execute on function public.signals_admin_month_spend() to authenticated;
create or replace function private.save_signals_client(p_id uuid,p_revision integer,p_details jsonb) returns integer
 language plpgsql security definer set search_path='' as $$
 declare result integer; cap integer; begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
 perform 1 from public.workspaces where id=p_id and is_signals_client and status<>'archived' for update;
 if not found then raise exception 'Client unavailable'; end if;
 if length(trim(coalesce(p_details->>'name',''))) not between 1 and 120 then raise exception 'Enter a client name'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_details->>'timezone') then raise exception 'Choose a valid timezone'; end if;
 if coalesce(p_details->>'logo_url','')<>'' and (p_details->>'logo_url' !~ '^https://' or length(p_details->>'logo_url')>2000) then raise exception 'Use an HTTPS logo URL'; end if;
 cap:=(p_details->>'profile_limit')::integer;
 if cap is null or cap not in (2,5,10) then raise exception 'Choose a placeholder plan'; end if;
 if (select count(*) from public.campaigns where workspace_id=p_id and status<>'archived')>cap then raise exception 'This plan has fewer profiles than the client already uses'; end if;
 update public.workspaces set name=trim(p_details->>'name'),timezone=p_details->>'timezone',logo_url=coalesce(p_details->>'logo_url',''),website=coalesce(p_details->>'website',website),client_type=coalesce(p_details->>'client_type',client_type),profile_limit=cap,setup_revision=setup_revision+1
 where id=p_id and setup_revision=p_revision returning setup_revision into result;
 if not found then raise exception 'Setup changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 return result; end; $$;

commit;
