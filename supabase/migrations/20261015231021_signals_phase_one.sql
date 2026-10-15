-- Phase 1 only: client accounts, platform authority, and invitation acceptance.
-- Additive migration. Existing CRM columns, tables and permissive policies stay intact.
begin;

alter table public.workspaces add column is_signals_client boolean not null default false;
alter table public.workspaces add column status text not null default 'setup'
 check (status in ('setup','live','paused','archived'));
update public.workspaces set status='live' where is_legacy_default;
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
 check (role in ('owner','reviewer','researcher','client_admin','client_user'));
alter table public.workspace_members add column receives_morning_email boolean not null default false;

create table public.platform_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public,anon,authenticated;
grant select on public.platform_admins to authenticated;
grant all on public.platform_admins to service_role;

-- Bootstrap only the verified existing owner, never a client or a JWT metadata claim.
insert into public.platform_admins(user_id,workspace_id)
 select m.user_id,m.workspace_id from public.workspace_members m
 join public.workspaces w on w.id=m.workspace_id
 join auth.users u on u.id=m.user_id
 where w.is_legacy_default and m.role='owner' and m.status='active'
 and lower(u.email)='corisleachman@googlemail.com' and u.email_confirmed_at is not null;

create function private.is_platform_admin() returns boolean
 language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists (
  select 1 from public.platform_admins p where p.user_id=(select auth.uid()) and p.active
 ); $$;
revoke all on function private.is_platform_admin() from public,anon;
grant execute on function private.is_platform_admin() to authenticated,service_role;
create policy "read own platform authority" on public.platform_admins for select to authenticated
 using (user_id=(select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy "platform reads workspaces" on public.workspaces for select to authenticated
 using ((select private.is_platform_admin()));
create policy "platform reads memberships" on public.workspace_members for select to authenticated
 using ((select private.is_platform_admin()));

create table public.workspace_invites (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 email text not null check (email=lower(trim(email)) and length(email)<=254),
 role text not null check (role in ('client_admin','client_user')),
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz,
 accepted_by uuid references auth.users(id),
 revoked_at timestamptz,
 delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index workspace_invites_workspace_idx on public.workspace_invites(workspace_id,created_at desc);
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from public,anon,authenticated;
grant select on public.workspace_invites to authenticated;
grant all on public.workspace_invites to service_role;
create policy "platform reads invites" on public.workspace_invites for select to authenticated
 using ((select private.is_platform_admin()));

create function private.create_signals_client(p_name text,p_timezone text) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare new_id uuid;
 begin
  if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Invalid client name'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  insert into public.workspaces(name,slug,timezone,status,is_signals_client)
  values(trim(p_name),'client-'||gen_random_uuid()::text,p_timezone,'setup',true) returning id into new_id;
  return new_id;
 end; $$;

create function private.create_signals_invite(p_workspace_id uuid,p_email text,p_role text,p_token_hash text) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare new_id uuid;
 begin
  if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
  -- Serialize resend/revocation and reject any attempt to invite clients into V1.
  perform 1 from public.workspaces where id=p_workspace_id and is_signals_client and not is_legacy_default and status<>'archived' for update;
  if not found then raise exception 'Client unavailable'; end if;
  if p_role not in ('client_admin','client_user') or p_role is null then raise exception 'Invalid role'; end if;
  if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
  update public.workspace_invites set revoked_at=now() where workspace_id=p_workspace_id
   and email=lower(trim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.workspace_invites(workspace_id,email,role,token_hash,created_by)
   values(p_workspace_id,lower(trim(p_email)),p_role,p_token_hash,auth.uid()) returning id into new_id;
  return new_id;
 end; $$;

create function private.mark_signals_invite_delivery(p_id uuid,p_sent boolean) returns void
 language plpgsql security definer set search_path='' as $$
 begin
  if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501'; end if;
  update public.workspace_invites set delivery_status=case when p_sent then 'sent' else 'failed' end,
   revoked_at=case when p_sent then revoked_at else coalesce(revoked_at,now()) end where id=p_id;
 end; $$;

create function private.preview_signals_invite(p_token_hash text)
 returns table(workspace_id uuid,workspace_name text,invite_role text,expires_at timestamptz)
 language sql stable security definer set search_path='' as $$
 select i.workspace_id,w.name,i.role,i.expires_at from public.workspace_invites i
 join public.workspaces w on w.id=i.workspace_id
 join auth.users u on u.id=(select auth.uid())
 where i.token_hash=p_token_hash and lower(u.email)=i.email and u.email_confirmed_at is not null
 and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
 and w.is_signals_client and not w.is_legacy_default and w.status<>'archived'; $$;

create function private.accept_signals_invite(p_token_hash text) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare invitation public.workspace_invites; verified_email text; result_id uuid;
 begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode='42501'; end if;
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select i.* into invitation from public.workspace_invites i
   join public.workspaces w on w.id=i.workspace_id
   where i.token_hash=p_token_hash and i.email=verified_email and i.accepted_at is null
   and i.revoked_at is null and i.expires_at>now() and w.is_signals_client and not w.is_legacy_default and w.status<>'archived'
   for update of i;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  -- A resend never changes an existing member's role or reinstates a suspended member.
  insert into public.workspace_members(workspace_id,user_id,role,status,is_default)
   values(invitation.workspace_id,auth.uid(),invitation.role,'active',false)
   on conflict(workspace_id,user_id) do nothing;
  if not exists(select 1 from public.workspace_members where workspace_id=invitation.workspace_id
   and user_id=auth.uid() and status='active') then raise exception 'Membership unavailable' using errcode='42501'; end if;
  update public.workspace_invites set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
  return invitation.workspace_id;
 end; $$;

-- Public endpoints are invokers; private, narrowly scoped definers enforce identity
-- and read trusted membership rows. No secret/service key is needed for these RPCs.
create function public.create_signals_client(p_name text,p_timezone text) returns uuid
 language sql security invoker set search_path='' as $$ select private.create_signals_client(p_name,p_timezone); $$;
create function public.create_signals_invite(p_workspace_id uuid,p_email text,p_role text,p_token_hash text) returns uuid
 language sql security invoker set search_path='' as $$ select private.create_signals_invite(p_workspace_id,p_email,p_role,p_token_hash); $$;
create function public.mark_signals_invite_delivery(p_id uuid,p_sent boolean) returns void
 language sql security invoker set search_path='' as $$ select private.mark_signals_invite_delivery(p_id,p_sent); $$;
create function public.preview_signals_invite(p_token_hash text)
 returns table(workspace_id uuid,workspace_name text,invite_role text,expires_at timestamptz)
 language sql security invoker set search_path='' as $$ select * from private.preview_signals_invite(p_token_hash); $$;
create function public.accept_signals_invite(p_token_hash text) returns uuid
 language sql security invoker set search_path='' as $$ select private.accept_signals_invite(p_token_hash); $$;

do $$ declare fn text; begin
 foreach fn in array array[
 'create_signals_client(text,text)','create_signals_invite(uuid,text,text,text)',
 'mark_signals_invite_delivery(uuid,boolean)','preview_signals_invite(text)','accept_signals_invite(text)'
 ] loop
 execute 'revoke all on function private.'||fn||' from public,anon';
 execute 'revoke all on function public.'||fn||' from public,anon';
 execute 'grant execute on function private.'||fn||' to authenticated';
 execute 'grant execute on function public.'||fn||' to authenticated';
 end loop;
end $$;

-- Step 3a currently grants client_admin configuration writes and all members
-- access to cost/provider records. Restrictive policies keep legacy workspace
-- behavior in every existing workspace but quarantine explicitly marked Signals clients until phase-specific policies are added.
create function private.is_signals_client_workspace(p_id uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspaces where id=p_id and is_signals_client); $$;
revoke all on function private.is_signals_client_workspace(uuid) from public,anon;
grant execute on function private.is_signals_client_workspace(uuid) to authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['campaigns','campaign_prospects','signal_definitions',
 'campaign_signal_rules','campaign_source_rules','search_runs','source_tasks','provider_payloads',
 'evidence_items','entity_matches','signals','signal_sources','campaign_signals'] loop
 execute format('create policy "phase one restrict client access" on public.%I as restrictive for all to authenticated using (workspace_id is null or not private.is_signals_client_workspace(workspace_id) or (select private.is_platform_admin())) with check (workspace_id is null or not private.is_signals_client_workspace(workspace_id) or (select private.is_platform_admin()))',t);
 execute format('create policy "platform manages signals" on public.%I for all to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))',t);
 end loop;
end $$;
commit;
