begin;
alter table public.workspaces add column logo_url text not null default '' check (logo_url='' or logo_url ~ '^https://');
alter table public.workspaces add column profile_limit integer not null default 5 check (profile_limit between 1 and 100);
alter table public.workspaces add column setup_revision integer not null default 0;
alter table public.workspace_members add column display_name text not null default '' check (length(display_name)<=120);
alter table public.campaigns add column profile_type text not null default 'cold_outbound' check(profile_type in ('cold_outbound','introducer','partner'));
alter table public.campaigns add column who text not null default '';
alter table public.campaigns add column criteria jsonb not null default '{}' check(jsonb_typeof(criteria)='object');
alter table public.campaigns add column priority_titles text[] not null default '{}';
alter table public.campaigns add column relevant_moment text not null default '';
alter table public.campaigns add column conversation_to_open text not null default '';
alter table public.campaigns add column watch_list_size integer not null default 200 check(watch_list_size between 1 and 10000);
alter table public.campaigns add column when_no_person text not null default 'needs_person' check(when_no_person in ('needs_person','drop'));
alter table public.campaigns add column setup_revision integer not null default 0;

-- Shared, platform-managed entities. workspace_id records provenance. No client
-- reads until the delivery phases define exactly which entities a card exposes.
create table public.companies (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 200), website text, domain text,
 linkedin_url text, industry text, location text, revenue_range jsonb, headcount_range jsonb,
 parent_company_id uuid references public.companies(id), provider_ids jsonb not null default '{}' check(jsonb_typeof(provider_ids)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(parent_company_id is distinct from id)
);
create unique index companies_domain_unique on public.companies(lower(domain)) where domain is not null;
create index companies_workspace_idx on public.companies(workspace_id);
create index companies_parent_idx on public.companies(parent_company_id);
create table public.people (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 200), title text,
 company_id uuid references public.companies(id), linkedin_url text, location text,
 provider_ids jsonb not null default '{}' check(jsonb_typeof(provider_ids)='object'), last_checked_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index people_workspace_idx on public.people(workspace_id);
create index people_company_idx on public.people(company_id);
do $$ declare t text; begin foreach t in array array['companies','people'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform manages entities" on public.%I for all to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))',t);
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 end loop; end $$;

-- Serialize profile creation against the workspace and enforce caps for every
-- writer, including direct REST calls. Existing V1 campaigns are unaffected.
create function private.enforce_signals_profile_limit() returns trigger
 language plpgsql security definer set search_path='' as $$
 declare cap integer; begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id and new.status=old.status then return new; end if;
 select profile_limit into cap from public.workspaces where id=new.workspace_id and is_signals_client for update;
 if found and new.status<>'archived' and
 (select count(*) from public.campaigns where workspace_id=new.workspace_id and status<>'archived' and id<>new.id)>=cap then
 raise exception 'Profile limit reached. Choose a larger placeholder plan.' using errcode='P0001'; end if;
 return new; end; $$;
revoke all on function private.enforce_signals_profile_limit() from public,anon,authenticated;
create trigger signals_profile_limit before insert or update on public.campaigns for each row execute function private.enforce_signals_profile_limit();

create function private.save_signals_client(p_id uuid,p_revision integer,p_details jsonb) returns integer
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
 update public.workspaces set name=trim(p_details->>'name'),timezone=p_details->>'timezone',logo_url=coalesce(p_details->>'logo_url',''),profile_limit=cap,setup_revision=setup_revision+1
 where id=p_id and setup_revision=p_revision returning setup_revision into result;
 if not found then raise exception 'Setup changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 return result; end; $$;

create function private.save_signals_profile(p_workspace_id uuid,p_id uuid,p_revision integer,p_profile jsonb) returns integer
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
 update public.campaigns set name=trim(p_profile->>'name'),profile_type=coalesce(p_profile->>'profile_type','cold_outbound'),
 who=coalesce(p_profile->>'who',''),criteria=coalesce(p_profile->'criteria','{}'),
 priority_titles=array(select jsonb_array_elements_text(coalesce(p_profile->'priority_titles','[]'))),
 relevant_moment=coalesce(p_profile->>'relevant_moment',''),conversation_to_open=coalesce(p_profile->>'conversation_to_open',''),
 watch_list_size=coalesce((p_profile->>'watch_list_size')::integer,200),when_no_person=coalesce(p_profile->>'when_no_person','needs_person'),setup_revision=setup_revision+1
 where id=p_id and workspace_id=p_workspace_id and status<>'archived' and setup_revision=p_revision returning setup_revision into result;
 if not found then raise exception 'Profile changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 return result; end; $$;

create function private.create_signals_profile(p_workspace_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare new_id uuid; label text; n integer:=1; begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
 perform 1 from public.workspaces where id=p_workspace_id and is_signals_client and status<>'archived' for update;
 if not found then raise exception 'Client unavailable'; end if;
 loop label:='Profile '||n; exit when not exists(select 1 from public.campaigns where workspace_id=p_workspace_id and lower(trim(name))=lower(label)); n:=n+1; end loop;
 insert into public.campaigns(workspace_id,name) values(p_workspace_id,label) returning id into new_id;
 return new_id; end; $$;

create function private.set_signals_member_name(p_workspace_id uuid,p_user_id uuid,p_name text) returns void
 language plpgsql security definer set search_path='' as $$ begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
 if length(p_name)>120 or p_name is null then raise exception 'Name is too long'; end if;
 update public.workspace_members set display_name=trim(p_name) where workspace_id=p_workspace_id and user_id=p_user_id
 and exists(select 1 from public.workspaces where id=p_workspace_id and is_signals_client);
 if not found then raise exception 'Member unavailable'; end if;
 end; $$;
create function public.save_signals_client(p_id uuid,p_revision integer,p_details jsonb) returns integer language sql security invoker set search_path='' as $$select private.save_signals_client(p_id,p_revision,p_details);$$;
create function public.save_signals_profile(p_workspace_id uuid,p_id uuid,p_revision integer,p_profile jsonb) returns integer language sql security invoker set search_path='' as $$select private.save_signals_profile(p_workspace_id,p_id,p_revision,p_profile);$$;
create function public.create_signals_profile(p_workspace_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_signals_profile(p_workspace_id);$$;
create function public.set_signals_member_name(p_workspace_id uuid,p_user_id uuid,p_name text) returns void language sql security invoker set search_path='' as $$select private.set_signals_member_name(p_workspace_id,p_user_id,p_name);$$;
create function private.signals_team(p_workspace_id uuid) returns table(user_id uuid,email text,display_name text,role text,status text)
 language sql stable security definer set search_path='' as $$
 select m.user_id,u.email::text,m.display_name,m.role,m.status from public.workspace_members m join auth.users u on u.id=m.user_id
 where m.workspace_id=p_workspace_id and private.is_platform_admin() and exists(select 1 from public.workspaces where id=p_workspace_id and is_signals_client);$$;
create function public.signals_team(p_workspace_id uuid) returns table(user_id uuid,email text,display_name text,role text,status text) language sql security invoker set search_path='' as $$select * from private.signals_team(p_workspace_id);$$;
do $$ declare fn text; begin foreach fn in array array['save_signals_client(uuid,integer,jsonb)','save_signals_profile(uuid,uuid,integer,jsonb)','create_signals_profile(uuid)','set_signals_member_name(uuid,uuid,text)','signals_team(uuid)'] loop
 execute 'revoke all on function private.'||fn||' from public,anon'; execute 'revoke all on function public.'||fn||' from public,anon';
 execute 'grant execute on function private.'||fn||' to authenticated'; execute 'grant execute on function public.'||fn||' to authenticated'; end loop; end $$;
commit;
