-- ============================================================================
-- STEP 2 · fix · Fast "Needs tidying", fast import suggestions, and people
-- inherit their agency's company details where their own are blank.
-- ----------------------------------------------------------------------------
-- 1. agency_tidy_suggestions() took ~10 s on 1,053 agencies (a function call
--    on every pair) and hit the API's 8 s limit. The loose key is now a stored,
--    indexed column, and "starts with" uses an index range scan.
-- 2. import_suggest() uses the same column.
-- 3. Contacts get website / domain / LinkedIn / industry / size / location
--    from their agency where their own field is blank (agency is master).
--    Never overwrites. Fixes e.g. email generation finding no domain.
-- ============================================================================

alter table public.agencies
  add column loose_key text generated always as (nullif(replace(name_key, 'and', ''), '')) stored;
create index agencies_loose_key_idx on public.agencies (workspace_id, (loose_key collate "C"));

create or replace function public.agency_tidy_suggestions()
returns table (kind text, agency_id uuid, agency_name text, other_id uuid, other_name text, detail text)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select 'same_website'::text as kind, a.id as agency_id, a.name as agency_name, b.id as other_id, b.name as other_name, a.domain as detail
      from public.agencies a join public.agencies b
        on a.workspace_id = b.workspace_id and a.domain = b.domain and a.id < b.id
    union all
    -- same loose key ("Heaps + Stacks" / "Heaps & Stacks")
    select 'similar_name', a.id, a.name, b.id, b.name, null
      from public.agencies a join public.agencies b
        on a.workspace_id = b.workspace_id and a.loose_key = b.loose_key and a.id < b.id
     where length(a.loose_key) >= 4
       and (a.domain is null or b.domain is null or a.domain = b.domain)
    union all
    -- one name starts with the other ("Carousel" / "Carousel Manchester").
    -- Keys are [a-z0-9] only, so "{" sorts after every key: a range scan.
    select 'similar_name', a.id, a.name, b.id, b.name, null
      from public.agencies a join public.agencies b
        on a.workspace_id = b.workspace_id
       and (b.loose_key collate "C") > (a.loose_key collate "C")
       and (b.loose_key collate "C") < ((a.loose_key || '{') collate "C")
     where length(a.loose_key) >= 4
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

-- import_suggest: use the indexed loose_key column (same logic as before)
create or replace function public.import_suggest(batch uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  b public.import_batches%rowtype;
  r public.import_rows%rowtype;
  k text; lk text; dom text; aid uuid; areason text; asug text;
  cid uuid; csug text; creason text; cagency uuid;
  nm text; em text; slug text;
begin
  select * into b from public.import_batches where id = batch for update;
  if b.id is null then raise exception 'Import not found'; end if;
  if b.status <> 'draft' then raise exception 'This import has already been %', b.status; end if;

  for r in select * from public.import_rows where batch_id = batch order by row_no loop
    k   := private.agency_name_key(r.mapped->>'company');
    lk  := private.agency_loose_key(k);
    dom := private.domain_from_url(coalesce(nullif(r.mapped->>'company_domain',''), r.mapped->>'website'));
    aid := null; areason := null; asug := null;
    if k is null then
      asug := 'none';
    else
      select a.id into aid from public.agencies a where a.workspace_id = b.workspace_id and a.name_key = k;
      if aid is not null then
        asug := 'match'; areason := 'Same name';
      else
        if dom is not null then
          select a.id into aid from public.agencies a
           where a.workspace_id = b.workspace_id and a.domain = dom limit 1;
          if aid is not null then asug := 'possible'; areason := 'Same website (' || dom || ')'; end if;
        end if;
        if aid is null and lk is not null then
          select a.id into aid from public.agencies a
           where a.workspace_id = b.workspace_id and a.loose_key = lk limit 1;
          if aid is not null then asug := 'possible'; areason := 'Almost the same name'; end if;
        end if;
        if aid is null and length(lk) >= 4 then
          -- existing agency name starts with this one, or this one starts with an existing name
          select a.id into aid from public.agencies a
           where a.workspace_id = b.workspace_id and length(a.loose_key) >= 4
             and ( ((a.loose_key collate "C") > (lk collate "C") and (a.loose_key collate "C") < ((lk || '{') collate "C"))
                or (lk like a.loose_key || '%') )
           order by abs(length(a.name_key) - length(k)) limit 1;
          if aid is not null then asug := 'possible'; areason := 'Similar name'; end if;
        end if;
        if aid is null then asug := 'new'; end if;
      end if;
    end if;

    nm := nullif(btrim(coalesce(r.mapped->>'name','')), '');
    em := nullif(lower(btrim(coalesce(r.mapped->>'email',''))), '');
    slug := private.li_slug(r.mapped->>'linkedin_url');
    cid := null; csug := null; creason := null; cagency := null;
    if nm is null then
      csug := 'none';
    else
      if slug is not null then
        select c.id, c.agency_id into cid, cagency from public.contacts c
         where c.workspace_id = b.workspace_id and private.li_slug(c.linkedin_url) = slug limit 1;
        if cid is not null then creason := 'Same LinkedIn profile'; end if;
      end if;
      if cid is null and em is not null then
        select c.id, c.agency_id into cid, cagency from public.contacts c
         where c.workspace_id = b.workspace_id and lower(c.email) = em limit 1;
        if cid is not null then creason := 'Same email'; end if;
      end if;
      if cid is null then
        select c.id, c.agency_id into cid, cagency from public.contacts c
         where c.workspace_id = b.workspace_id and lower(btrim(c.name)) = lower(nm)
         order by (c.agency_id is not distinct from aid) desc limit 1;
        if cid is not null then
          creason := case when cagency is not distinct from aid and asug = 'match'
                          then 'Same name, same agency'
                          else 'Same name at ' || coalesce((select a.name from public.agencies a where a.id = cagency), 'no agency') end;
        end if;
      end if;
      if cid is null then
        csug := 'new';
      elsif creason in ('Same LinkedIn profile','Same email','Same name, same agency') then
        csug := 'match';
      else
        csug := 'possible';
      end if;
    end if;

    update public.import_rows set
      agency_suggestion = asug, agency_candidate_id = aid, agency_reason = areason,
      agency_action = case asug when 'match' then 'match' when 'new' then 'new' when 'possible' then 'review' else 'none' end,
      agency_id = case when asug = 'match' then aid else null end,
      contact_suggestion = csug, contact_candidate_id = cid, contact_reason = creason,
      contact_action = case csug when 'match' then 'update' when 'new' then 'new' when 'possible' then 'review' else 'none' end,
      contact_id = case when csug = 'match' then cid else null end
    where id = r.id;
  end loop;

  return (select jsonb_build_object(
    'rows', count(*),
    'agency', jsonb_build_object('match', count(*) filter (where agency_suggestion='match'),
                                 'new', count(*) filter (where agency_suggestion='new'),
                                 'possible', count(*) filter (where agency_suggestion='possible'),
                                 'none', count(*) filter (where agency_suggestion='none')),
    'person', jsonb_build_object('match', count(*) filter (where contact_suggestion='match'),
                                 'new', count(*) filter (where contact_suggestion='new'),
                                 'possible', count(*) filter (where contact_suggestion='possible'),
                                 'none', count(*) filter (where contact_suggestion='none')))
    from public.import_rows where batch_id = batch);
end $$;

-- People inherit their agency's company details where their own are blank.
update public.contacts c set
  website              = coalesce(nullif(btrim(c.website),''), a.website),
  company_domain       = coalesce(nullif(btrim(c.company_domain),''), a.domain),
  company_linkedin_url = coalesce(nullif(btrim(c.company_linkedin_url),''), a.linkedin_url),
  company_industry     = coalesce(nullif(btrim(c.company_industry),''), a.industry),
  company_size         = coalesce(nullif(btrim(c.company_size),''), a.size_band),
  company_city         = coalesce(nullif(btrim(c.company_city),''), a.city),
  company_country      = coalesce(nullif(btrim(c.company_country),''), a.country)
from public.agencies a
where c.agency_id = a.id
  and ( (nullif(btrim(c.website),'') is null and a.website is not null)
     or (nullif(btrim(c.company_domain),'') is null and a.domain is not null)
     or (nullif(btrim(c.company_linkedin_url),'') is null and a.linkedin_url is not null)
     or (nullif(btrim(c.company_industry),'') is null and a.industry is not null)
     or (nullif(btrim(c.company_size),'') is null and a.size_band is not null)
     or (nullif(btrim(c.company_city),'') is null and a.city is not null)
     or (nullif(btrim(c.company_country),'') is null and a.country is not null) );

-- unmerge_agencies: agencies now has a generated column (loose_key), so the
-- recreated agency is inserted with an explicit column list.
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

  d  := jsonb_populate_record(null::public.agencies, m.dropped - 'loose_key');
  kb := jsonb_populate_record(null::public.agencies, m.keep_before - 'loose_key');

  insert into public.agencies (id, workspace_id, name, name_key, domain, website, linkedin_url, industry, size_band,
                               revenue, founded_year, city, country, description, ownership, parent_group, tier,
                               notes, source, created_at, updated_at)
  values (d.id, d.workspace_id, d.name, d.name_key, d.domain, d.website, d.linkedin_url, d.industry, d.size_band,
          d.revenue, d.founded_year, d.city, d.country, d.description, d.ownership, d.parent_group, d.tier,
          d.notes, d.source, d.created_at, d.updated_at);

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

  update public.agency_notes set agency_id = d.id where id = any(m.note_ids);

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
