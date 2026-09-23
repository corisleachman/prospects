-- ============================================================================
-- STEP 1 · 1/5 · Workspaces
-- A workspace owns every prospect record. One workspace ("Coris") is created
-- and flagged as the legacy default, so every existing writer (dashboard,
-- Chrome extension, find-people, signal scan) keeps working unchanged.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.workspaces (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  timezone          text not null default 'Europe/London',
  is_legacy_default boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index workspaces_single_legacy_default
  on public.workspaces (is_legacy_default) where is_legacy_default;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner'
               check (role in ('owner','reviewer','researcher','client_admin')),
  status       text not null default 'active'
               check (status in ('active','invited','suspended')),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create unique index workspace_members_single_default
  on public.workspace_members (user_id) where is_default;
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Workspaces the current user belongs to. SECURITY DEFINER so policies can
-- call it without recursing through workspace_members' own RLS.
create or replace function private.my_workspace_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;

-- Workspace to stamp on new rows: the caller's default membership, otherwise
-- the legacy default (covers service-role writers such as save-prospect).
create or replace function private.current_workspace_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select m.workspace_id from public.workspace_members m
      where m.user_id = (select auth.uid()) and m.status = 'active'
      order by m.is_default desc, m.created_at limit 1),
    (select w.id from public.workspaces w where w.is_legacy_default limit 1)
  )
$$;

revoke all on function private.my_workspace_ids() from public;
revoke all on function private.current_workspace_id() from public;
grant execute on function private.my_workspace_ids() to authenticated, service_role;
grant execute on function private.current_workspace_id() to authenticated, service_role;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger touch_updated_at before update on public.workspaces
  for each row execute function private.touch_updated_at();

-- RLS: members can see their workspaces and fellow members. No write
-- policies yet: memberships are managed server-side until the team UI exists.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members read workspace" on public.workspaces
  for select to authenticated
  using (id in (select private.my_workspace_ids()));

create policy "members read memberships" on public.workspace_members
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

revoke all on public.workspaces, public.workspace_members from anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

-- Seed: the Coris workspace, with the existing owner account as its owner.
insert into public.workspaces (name, slug, is_legacy_default)
values ('Coris Leachman', 'coris', true)
on conflict (slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, role, is_default)
select w.id, u.id, 'owner', true
from public.workspaces w
join auth.users u on lower(u.email) = 'corisleachman@googlemail.com'
where w.slug = 'coris'
on conflict do nothing;
