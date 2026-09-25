-- ============================================================================
-- STEP 2a · 1/2 · Agency as master record, notes, merge/unmerge, summary
-- ----------------------------------------------------------------------------
-- * Editing an agency pushes its company details onto its people's existing
--   company_* fields, so everything that reads those fields keeps working.
-- * Renaming an agency renames it on its people (contacts.company).
-- * merge_agencies / unmerge_agencies: one-click merge with undo.
-- * agency_notes: dated intel log per agency (imports write here).
-- * agency_summary: list view with people, decision-makers, stage, last contact.
-- * agency_tidy_suggestions: duplicates / odd names / missing websites.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.try_date(t text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return btrim(t)::date;
exception when others then
  return null;
end $$;

create or replace function private.try_int(t text)
returns bigint language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(t,''), '[^0-9]', '', 'g'), '')::bigint
$$;

grant execute on function private.try_date(text), private.try_int(text) to authenticated, service_role;

-- Looser comparison for SUGGESTIONS only (never for automatic matching):
-- ignores "and", so "Heaps + Stacks" (heapsstacks) ~ "Heaps & Stacks" (heapsandstacks).
create or replace function private.agency_loose_key(k text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select nullif(replace(coalesce(k, ''), 'and', ''), '')
$$;
grant execute on function private.agency_loose_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rename: keep name_key in step with name (unique per workspace).
-- A rename onto an existing agency's name fails with 23505 → "merge instead".
-- ---------------------------------------------------------------------------
create or replace function private.agency_set_name_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.name_key := private.agency_name_key(new.name);
  if new.name_key is null then
    raise exception 'Agency name cannot be blank' using errcode = '23514';
  end if;
  if new.domain is null and new.website is not null then
    new.domain := private.domain_from_url(new.website);
  end if;
  return new;
end $$;

create trigger a10_set_name_key before insert or update of name, website on public.agencies
  for each row execute function private.agency_set_name_key();

-- ---------------------------------------------------------------------------
-- Agency → people sync. Only fields that changed in this update are pushed,
-- including clears. Skipped for nested updates (e.g. blank-filling from the
-- contact trigger) so the two triggers can never loop.
-- ---------------------------------------------------------------------------
create or replace function private.sync_agency_to_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.contacts c set
    company              = case when new.name         is distinct from old.name         then new.name         else c.company end,
    website              = case when new.website      is distinct from old.website      then new.website      else c.website end,
    company_domain       = case when new.domain       is distinct from old.domain       then new.domain       else c.company_domain end,
    company_linkedin_url = case when new.linkedin_url is distinct from old.linkedin_url then new.linkedin_url else c.company_linkedin_url end,
    company_industry     = case when new.industry     is distinct from old.industry     then new.industry     else c.company_industry end,
    company_size         = case when new.size_band    is distinct from old.size_band    then new.size_band    else c.company_size end,
    company_revenue      = case when new.revenue      is distinct from old.revenue      then new.revenue      else c.company_revenue end,
    company_founded_year = case when new.founded_year is distinct from old.founded_year then new.founded_year else c.company_founded_year end,
    company_city         = case when new.city         is distinct from old.city         then new.city         else c.company_city end,
    company_country      = case when new.country      is distinct from old.country      then new.country      else c.company_country end,
    company_description  = case when new.description  is distinct from old.description  then new.description  else c.company_description end,
    ownership            = case when new.ownership    is distinct from old.ownership    then new.ownership    else c.ownership end
  where c.agency_id = new.id
    and ( new.name is distinct from old.name or new.website is distinct from old.website
       or new.domain is distinct from old.domain or new.linkedin_url is distinct from old.linkedin_url
       or new.industry is distinct from old.industry or new.size_band is distinct from old.size_band
       or new.revenue is distinct from old.revenue or new.founded_year is distinct from old.founded_year
       or new.city is distinct from old.city or new.country is distinct from old.country
       or new.description is distinct from old.description or new.ownership is distinct from old.ownership );
  return null;
end $$;
revoke all on function private.sync_agency_to_contacts() from public;

create trigger z10_sync_agency_to_contacts after update on public.agencies
  for each row execute function private.sync_agency_to_contacts();

-- ---------------------------------------------------------------------------
-- Agency notes: dated intel log
-- ---------------------------------------------------------------------------
create table public.agency_notes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete restrict,
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  noted_on        date not null default current_date,
  source          text,
  body            text not null check (btrim(body) <> ''),
  link            text,
  import_batch_id uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index agency_notes_agency_idx on public.agency_notes (agency_id, noted_on desc);
create index agency_notes_workspace_idx on public.agency_notes (workspace_id);
create index agency_notes_contact_idx on public.agency_notes (contact_id) where contact_id is not null;
create index agency_notes_batch_idx on public.agency_notes (import_batch_id) where import_batch_id is not null;

create trigger a00_set_workspace_id before insert on public.agency_notes
  for each row execute function private.set_workspace_id();

alter table public.agency_notes enable row level security;
create policy "workspace members all" on public.agency_notes for all to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.agency_notes from anon, authenticated;
grant select, insert, update, delete on public.agency_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Merge with undo
-- ---------------------------------------------------------------------------
create table public.agency_merges (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  keep_id      uuid not null,
  dropped      jsonb not null,          -- full row of the removed agency
  keep_before  jsonb not null,          -- keep agency before blanks were filled
  moved        jsonb not null,          -- [{id, company, website, company_domain, ...}] of moved people
  note_ids     uuid[] not null default '{}',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  undone_at    timestamptz
);
create index agency_merges_workspace_idx on public.agency_merges (workspace_id, created_at desc);
create trigger a00_set_workspace_id before insert on public.agency_merges
  for each row execute function private.set_workspace_id();
alter table public.agency_merges enable row level security;
create policy "workspace members all" on public.agency_merges for all to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.agency_merges from anon, authenticated;
grant select, insert, update on public.agency_merges to authenticated;

create or replace function public.merge_agencies(keep_id uuid, drop_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  k public.agencies%rowtype;
  d public.agencies%rowtype;
  kb jsonb;
  moved jsonb;
  moved_notes uuid[];
  mid uuid;
  n int;
begin
  if keep_id = drop_id then raise exception 'Cannot merge an agency into itself'; end if;
  select * into k from public.agencies where id = keep_id for update;
  select * into d from public.agencies where id = drop_id for update;
  if k.id is null or d.id is null then raise exception 'Agency not found'; end if;
  if k.workspace_id <> d.workspace_id then raise exception 'Agencies are in different workspaces'; end if;
  kb := to_jsonb(k);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'company', c.company, 'website', c.website, 'company_domain', c.company_domain,
           'company_linkedin_url', c.company_linkedin_url, 'company_industry', c.company_industry,
           'company_size', c.company_size, 'company_revenue', c.company_revenue,
           'company_founded_year', c.company_founded_year, 'company_city', c.company_city,
           'company_country', c.company_country, 'company_description', c.company_description,
           'ownership', c.ownership)), '[]'::jsonb)
    into moved from public.contacts c where c.agency_id = drop_id;

  -- 1. Fill blanks on the kept agency from the dropped one (pushes to kept people).
  update public.agencies set
    domain = coalesce(domain, d.domain), website = coalesce(website, d.website),
    linkedin_url = coalesce(linkedin_url, d.linkedin_url), industry = coalesce(industry, d.industry),
    size_band = coalesce(size_band, d.size_band), revenue = coalesce(revenue, d.revenue),
    founded_year = coalesce(founded_year, d.founded_year), city = coalesce(city, d.city),
    country = coalesce(country, d.country), description = coalesce(description, d.description),
    ownership = coalesce(ownership, d.ownership), parent_group = coalesce(parent_group, d.parent_group),
    tier = coalesce(tier, d.tier),
    notes = case when d.notes is null then notes when notes is null then d.notes else notes || E'\n' || d.notes end
  where id = keep_id
  returning * into k;

  -- 2. Move notes.
  with m as (update public.agency_notes set agency_id = keep_id where agency_id = drop_id returning id)
  select coalesce(array_agg(id), '{}') into moved_notes from m;

  -- 3. Move people onto the kept agency's name and company details.
  update public.contacts set
    company = k.name, agency_id = keep_id,
    website = k.website, company_domain = k.domain, company_linkedin_url = k.linkedin_url,
    company_industry = k.industry, company_size = k.size_band, company_revenue = k.revenue,
    company_founded_year = k.founded_year, company_city = k.city, company_country = k.country,
    company_description = k.description, ownership = k.ownership
  where agency_id = drop_id;
  get diagnostics n = row_count;

  -- 4. Remove the empty agency; record everything needed for undo.
  delete from public.agencies where id = drop_id;
  insert into public.agency_merges (workspace_id, keep_id, dropped, keep_before, moved, note_ids)
  values (k.workspace_id, keep_id, to_jsonb(d), kb, moved, moved_notes)
  returning id into mid;

  return jsonb_build_object('merge_id', mid, 'kept', k.name, 'dropped', d.name,
                            'moved_people', n, 'moved_notes', coalesce(array_length(moved_notes, 1), 0));
end $$;

create or replace function public.unmerge_agencies(merge_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  m public.agency_merges%rowtype;
  d public.agencies%rowtype;
  kb public.agencies%rowtype;
  p jsonb;
  n int := 0;
begin
  select * into m from public.agency_merges where id = merge_id for update;
  if m.id is null then raise exception 'Merge not found'; end if;
  if m.undone_at is not null then raise exception 'This merge has already been undone'; end if;

  d  := jsonb_populate_record(null::public.agencies, m.dropped);
  kb := jsonb_populate_record(null::public.agencies, m.keep_before);

  -- 1. Recreate the removed agency with its original id and details.
  insert into public.agencies select d.*;

  -- 2. Restore the kept agency's fields that the merge filled in (only if unchanged since).
  update public.agencies a set
    domain       = case when kb.domain       is null and a.domain       is not distinct from d.domain       then null else a.domain end,
    website      = case when kb.website      is null and a.website      is not distinct from d.website      then null else a.website end,
    linkedin_url = case when kb.linkedin_url is null and a.linkedin_url is not distinct from d.linkedin_url then null else a.linkedin_url end,
    industry     = case when kb.industry     is null and a.industry     is not distinct from d.industry     then null else a.industry end,
    size_band    = case when kb.size_band    is null and a.size_band    is not distinct from d.size_band    then null else a.size_band end,
    revenue      = case when kb.revenue      is null and a.revenue      is not distinct from d.revenue      then null else a.revenue end,
    founded_year = case when kb.founded_year is null and a.founded_year is not distinct from d.founded_year then null else a.founded_year end,
    city         = case when kb.city         is null and a.city         is not distinct from d.city         then null else a.city end,
    country      = case when kb.country      is null and a.country      is not distinct from d.country      then null else a.country end,
    description  = case when kb.description  is null and a.description  is not distinct from d.description  then null else a.description end,
    ownership    = case when kb.ownership    is null and a.ownership    is not distinct from d.ownership    then null else a.ownership end,
    parent_group = case when kb.parent_group is null and a.parent_group is not distinct from d.parent_group then null else a.parent_group end,
    tier         = case when kb.tier         is null and a.tier         is not distinct from d.tier         then null else a.tier end,
    notes        = kb.notes
  where a.id = m.keep_id;

  -- 3. Move notes back.
  update public.agency_notes set agency_id = d.id where id = any(m.note_ids);

  -- 4. Move people back with their original company details.
  for p in select * from jsonb_array_elements(m.moved) loop
    update public.contacts set
      company = p->>'company', agency_id = d.id,
      website = p->>'website', company_domain = p->>'company_domain',
      company_linkedin_url = p->>'company_linkedin_url', company_industry = p->>'company_industry',
      company_size = p->>'company_size', company_revenue = (p->>'company_revenue')::bigint,
      company_founded_year = (p->>'company_founded_year')::int, company_city = p->>'company_city',
      company_country = p->>'company_country', company_description = p->>'company_description',
      ownership = p->>'ownership'
    where id = (p->>'id')::uuid and agency_id = m.keep_id;
    if found then n := n + 1; end if;
  end loop;

  update public.agency_merges set undone_at = now() where id = merge_id;
  return jsonb_build_object('restored', d.name, 'moved_back_people', n);
end $$;

revoke all on function public.merge_agencies(uuid, uuid), public.unmerge_agencies(uuid) from public, anon;
grant execute on function public.merge_agencies(uuid, uuid), public.unmerge_agencies(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Summary view for the Agencies list (RLS applies through security_invoker)
-- ---------------------------------------------------------------------------
create view public.agency_summary with (security_invoker = true) as
select a.id, a.workspace_id, a.name, a.name_key, a.domain, a.website, a.linkedin_url, a.industry,
       a.size_band, a.revenue, a.founded_year, a.city, a.country, a.description, a.ownership,
       a.parent_group, a.tier, a.notes, a.source, a.created_at, a.updated_at,
       coalesce(p.people, 0)          as people_count,
       coalesce(p.decision_makers, 0) as decision_maker_count,
       p.max_stage                    as max_relationship_stage,
       p.last_contacted_at,
       coalesce(nt.notes, 0)          as notes_count,
       nt.latest_note_on
from public.agencies a
left join lateral (
  select count(*) filter (where c.status is distinct from 'Archived') as people,
         count(*) filter (where c.status is distinct from 'Archived'
                            and c.title ~* '(founder|\mceo\M|chief exec|managing director|\mmd\M|owner|managing partner|founding partner|\mpresident\M)') as decision_makers,
         max(c.relationship_stage) as max_stage,
         greatest(max(c.last_emailed_at), max(c.coris_actioned_at)) as last_contacted_at
  from public.contacts c where c.agency_id = a.id
) p on true
left join lateral (
  select count(*) as notes, max(n.noted_on) as latest_note_on
  from public.agency_notes n where n.agency_id = a.id
) nt on true;

revoke all on public.agency_summary from anon, authenticated;
grant select on public.agency_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Tidy suggestions (+ dismissals so a "no" sticks)
-- ---------------------------------------------------------------------------
create table public.agency_tidy_dismissals (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  kind         text not null,
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  other_id     uuid references public.agencies(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create unique index agency_tidy_dismissals_uniq
  on public.agency_tidy_dismissals (workspace_id, kind, agency_id, coalesce(other_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger a00_set_workspace_id before insert on public.agency_tidy_dismissals
  for each row execute function private.set_workspace_id();
alter table public.agency_tidy_dismissals enable row level security;
create policy "workspace members all" on public.agency_tidy_dismissals for all to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.agency_tidy_dismissals from anon, authenticated;
grant select, insert, delete on public.agency_tidy_dismissals to authenticated;

create or replace function public.agency_tidy_suggestions()
returns table (kind text, agency_id uuid, agency_name text, other_id uuid, other_name text, detail text)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select 'same_website'::text as kind, a.id as agency_id, a.name as agency_name, b.id as other_id, b.name as other_name, a.domain as detail
      from public.agencies a join public.agencies b
        on a.workspace_id = b.workspace_id and a.domain = b.domain and a.id < b.id
    union all
    select 'similar_name', a.id, a.name, b.id, b.name, null
      from public.agencies a join public.agencies b
        on a.workspace_id = b.workspace_id and a.id <> b.id
       and length(private.agency_loose_key(a.name_key)) >= 4
       and ( (private.agency_loose_key(a.name_key) = private.agency_loose_key(b.name_key) and a.id < b.id)
          or (private.agency_loose_key(b.name_key) like private.agency_loose_key(a.name_key) || '%'
              and private.agency_loose_key(b.name_key) <> private.agency_loose_key(a.name_key)) )
       and (a.domain is null or b.domain is null or a.domain = b.domain)
    union all
    select 'odd_name', a.id, a.name, null, null, null
      from public.agencies a
     where length(a.name_key) <= 2
        or a.name ~* '^(attn|to|re|fwd|pe|na|n/a|none|self|freelance|freelancer|independent|stealth)\W*$'
        or a.name ~ '·|•'
        or a.name ~* '\m(school|university|college)\M'
        or a.name ~ '[0-9]{5,}'
    union all
    select 'no_website', a.id, a.name, null, null, null
      from public.agencies a
     where a.website is null and a.domain is null
       and coalesce(a.tier, '') <> 'excluded'
       and exists (select 1 from public.contacts c where c.agency_id = a.id and c.status is distinct from 'Archived')
  )
  select s.* from s
  where not exists (
    select 1 from public.agency_tidy_dismissals x
     where x.kind = s.kind and x.agency_id = s.agency_id
       and coalesce(x.other_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(s.other_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by 1, 3
$$;
revoke all on function public.agency_tidy_suggestions() from public, anon;
grant execute on function public.agency_tidy_suggestions() to authenticated;
