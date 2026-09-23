-- ============================================================================
-- STEP 1 · 4/5 · Agencies
-- Agencies become real records. Every contact is linked to one through
-- contacts.agency_id. The link is maintained automatically by a trigger, so
-- CSV import, the Chrome extension, find-people and manual edits all keep
-- creating and linking agencies without code changes.
--
-- In Step 1 the Agencies screen still reads and writes the company fields on
-- contacts. The trigger copies those values onto the agency where the agency
-- field is still blank; it never overwrites. Step 2 moves the Agencies screen
-- onto this table and makes it the single place company details are edited.
-- ============================================================================

-- Matching key: lower-case, drops taglines after | — – " - ", "B Corp"
-- decorations, legal suffixes and "the", then all punctuation and spaces.
-- "Heaps + Stacks" = "Heaps Stacks"; "December19 | B Corp™" = "December 19";
-- "Presented Ltd." = "Presented".
create or replace function private.agency_name_key(company text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(normalize(trim(company), NFKC)), '\s*(\||—|–|\s-\s).*$', ''),
        '\m(b\s?corp|certified b corporation)\M.*$', ''),
      '&', ' and ', 'g'),
    '\m(ltd|limited|llp|plc|inc|llc|the)\M|[^a-z0-9]', '', 'g'),
  '')
$$;

-- Bare domain from a URL or domain; ignores social and link-in-bio hosts.
create or replace function private.domain_from_url(url text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when d is null or d !~ '\.' then null
    when d ~ '(^|\.)(linkedin\.com|instagram\.com|facebook\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|linktr\.ee|behance\.net|dribbble\.com|medium\.com|google\.com)$' then null
    else d
  end
  from (select nullif(lower(regexp_replace(regexp_replace(trim(url), '^[a-z]+://', '', 'i'), '^www\.|[/?#:].*$', '', 'g')), '') as d) s
$$;

grant execute on function private.agency_name_key(text), private.domain_from_url(text) to authenticated, service_role;

create table public.agencies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete restrict,
  name          text not null,
  name_key      text not null,
  domain        text,
  website       text,
  linkedin_url  text,
  industry      text,
  size_band     text,
  revenue       bigint,
  founded_year  integer,
  city          text,
  country       text,
  description   text,
  ownership     text,
  parent_group  text,
  tier          text check (tier is null or tier in ('focus','watch','excluded')),
  notes         text,
  source        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, name_key)
);
create index agencies_domain_idx on public.agencies (workspace_id, domain) where domain is not null;
create index agencies_tier_idx   on public.agencies (workspace_id, tier) where tier is not null;

create trigger a00_set_workspace_id before insert on public.agencies
  for each row execute function private.set_workspace_id();
create trigger touch_updated_at before update on public.agencies
  for each row execute function private.touch_updated_at();

alter table public.agencies enable row level security;
create policy "workspace members all" on public.agencies
  for all to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.agencies from anon, authenticated;
grant select, insert, update, delete on public.agencies to authenticated;

alter table public.contacts
  add column if not exists agency_id uuid references public.agencies(id) on delete set null;
create index if not exists contacts_agency_idx on public.contacts (agency_id);

-- ---------------------------------------------------------------------------
-- Backfill: one agency per (workspace, name_key). Each attribute takes the
-- most common non-blank value across that agency's contacts.
-- ---------------------------------------------------------------------------
insert into public.agencies
  (workspace_id, name, name_key, domain, website, linkedin_url, industry, size_band,
   revenue, founded_year, city, country, description, ownership, source, created_at)
select
  c.workspace_id,
  mode() within group (order by trim(c.company)),
  private.agency_name_key(c.company),
  mode() within group (order by private.domain_from_url(coalesce(nullif(c.company_domain,''), c.website)))
    filter (where private.domain_from_url(coalesce(nullif(c.company_domain,''), c.website)) is not null),
  mode() within group (order by trim(c.website))              filter (where nullif(trim(c.website),'') is not null),
  mode() within group (order by trim(c.company_linkedin_url)) filter (where nullif(trim(c.company_linkedin_url),'') is not null),
  mode() within group (order by trim(c.company_industry))     filter (where nullif(trim(c.company_industry),'') is not null),
  mode() within group (order by trim(c.company_size))         filter (where nullif(trim(c.company_size),'') is not null),
  mode() within group (order by c.company_revenue)            filter (where c.company_revenue is not null),
  mode() within group (order by c.company_founded_year)       filter (where c.company_founded_year is not null),
  mode() within group (order by trim(c.company_city))         filter (where nullif(trim(c.company_city),'') is not null),
  mode() within group (order by trim(c.company_country))      filter (where nullif(trim(c.company_country),'') is not null),
  mode() within group (order by c.company_description)        filter (where nullif(trim(c.company_description),'') is not null),
  mode() within group (order by trim(c.ownership))            filter (where nullif(trim(c.ownership),'') is not null),
  'contacts_backfill',
  min(c.created_at)
from public.contacts c
where private.agency_name_key(c.company) is not null
group by c.workspace_id, private.agency_name_key(c.company)
on conflict (workspace_id, name_key) do nothing;

update public.contacts c
set agency_id = a.id
from public.agencies a
where a.workspace_id = c.workspace_id
  and a.name_key = private.agency_name_key(c.company)
  and c.agency_id is distinct from a.id;

-- ---------------------------------------------------------------------------
-- Keep the link current for every future insert or company edit.
-- SECURITY DEFINER so it can create the agency whoever is writing
-- (dashboard user, researcher, or service-role edge function).
-- ---------------------------------------------------------------------------
create or replace function private.link_contact_agency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k   text := private.agency_name_key(new.company);
  aid uuid;
  dom text := private.domain_from_url(coalesce(nullif(new.company_domain,''), new.website));
begin
  if k is null then
    new.agency_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.agency_id is not null
     and new.agency_id = old.agency_id
     and k is not distinct from private.agency_name_key(old.company) then
    aid := new.agency_id;                       -- same agency, just refresh blanks
  else
    insert into public.agencies (workspace_id, name, name_key, source)
    values (new.workspace_id, trim(new.company), k, coalesce(nullif(new.source,''), 'contact'))
    on conflict (workspace_id, name_key) do nothing;
    select a.id into aid from public.agencies a
     where a.workspace_id = new.workspace_id and a.name_key = k;
    new.agency_id := aid;
  end if;

  -- Fill blank agency fields from this contact. Never overwrites.
  update public.agencies a set
    domain       = coalesce(a.domain, dom),
    website      = coalesce(a.website, nullif(trim(new.website),'')),
    linkedin_url = coalesce(a.linkedin_url, nullif(trim(new.company_linkedin_url),'')),
    industry     = coalesce(a.industry, nullif(trim(new.company_industry),'')),
    size_band    = coalesce(a.size_band, nullif(trim(new.company_size),'')),
    revenue      = coalesce(a.revenue, new.company_revenue),
    founded_year = coalesce(a.founded_year, new.company_founded_year),
    city         = coalesce(a.city, nullif(trim(new.company_city),'')),
    country      = coalesce(a.country, nullif(trim(new.company_country),'')),
    description  = coalesce(a.description, nullif(trim(new.company_description),'')),
    ownership    = coalesce(a.ownership, nullif(trim(new.ownership),''))
  where a.id = aid
    and ( (a.domain is null and dom is not null)
       or (a.website is null and nullif(trim(new.website),'') is not null)
       or (a.linkedin_url is null and nullif(trim(new.company_linkedin_url),'') is not null)
       or (a.industry is null and nullif(trim(new.company_industry),'') is not null)
       or (a.size_band is null and nullif(trim(new.company_size),'') is not null)
       or (a.revenue is null and new.company_revenue is not null)
       or (a.founded_year is null and new.company_founded_year is not null)
       or (a.city is null and nullif(trim(new.company_city),'') is not null)
       or (a.country is null and nullif(trim(new.company_country),'') is not null)
       or (a.description is null and nullif(trim(new.company_description),'') is not null)
       or (a.ownership is null and nullif(trim(new.ownership),'') is not null) );
  return new;
end $$;
revoke all on function private.link_contact_agency() from public;

-- "b10_" fires after a00_set_workspace_id, so workspace_id is already set.
create trigger b10_link_agency
  before insert or update of company, website, company_domain, company_linkedin_url,
    company_industry, company_size, company_revenue, company_founded_year,
    company_city, company_country, company_description, ownership
  on public.contacts
  for each row execute function private.link_contact_agency();
