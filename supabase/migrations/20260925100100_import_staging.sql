-- ============================================================================
-- STEP 2a · 2/2 · Agency-aware import: staging, match suggestions, commit, undo
-- ----------------------------------------------------------------------------
-- Flow: the browser creates an import_batches row and one import_rows row per
-- file row (mapped fields in `mapped`), then calls:
--   import_suggest(batch)  → fills suggested agency/person actions
--   (user reviews; browser updates agency_action / contact_action / ids)
--   import_commit(batch)   → applies every decision in one transaction
--   import_undo(batch)     → reverses it, leaving anything edited since
-- `mapped` keys: name, email, title, headline, seniority_level, linkedin_url,
-- city, country, notes, company, website, company_domain, company_linkedin_url,
-- company_industry, company_size, company_revenue, company_founded_year,
-- company_description, company_city, company_country, ownership,
-- note_text, note_link, note_date
-- ============================================================================

create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  file_name    text,
  defaults     jsonb not null default '{}'::jsonb,   -- {category, tier, source_label, source_tag}
  status       text not null default 'draft' check (status in ('draft','committed','undone')),
  summary      jsonb,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  committed_at timestamptz,
  undone_at    timestamptz
);
create index import_batches_workspace_idx on public.import_batches (workspace_id, created_at desc);

create table public.import_rows (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references public.import_batches(id) on delete cascade,
  workspace_id         uuid not null references public.workspaces(id) on delete restrict,
  row_no               integer not null,
  raw                  jsonb,
  mapped               jsonb not null default '{}'::jsonb,
  -- suggestions (import_suggest) --------------------------------------------
  agency_suggestion    text check (agency_suggestion in ('match','new','possible','none')),
  agency_candidate_id  uuid,
  agency_reason        text,
  contact_suggestion   text check (contact_suggestion in ('match','new','possible','none')),
  contact_candidate_id uuid,
  contact_reason       text,
  -- decisions (edited in the review screen) -----------------------------------
  agency_action        text check (agency_action in ('match','new','skip','review','none')),
  agency_id            uuid,
  contact_action       text check (contact_action in ('new','update','skip','review','none')),
  contact_id           uuid,
  -- results (import_commit) ---------------------------------------------------
  created_agency       boolean not null default false,
  created_contact      boolean not null default false,
  agency_filled        jsonb,   -- fields filled on an existing agency {field: value}
  contact_filled       jsonb,   -- fields filled on an existing contact
  agency_md5           text,    -- fingerprint at commit (created agencies), for undo
  contact_md5          text,
  note_id              uuid,
  unique (batch_id, row_no)
);
create index import_rows_batch_idx on public.import_rows (batch_id, row_no);
create index import_rows_workspace_idx on public.import_rows (workspace_id);

do $$
declare t text;
begin
  foreach t in array array['import_batches','import_rows'] loop
    execute format('create trigger a00_set_workspace_id before insert on public.%I for each row execute function private.set_workspace_id()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "workspace members all" on public.%I for all to authenticated
                      using (workspace_id in (select private.my_workspace_ids()))
                      with check (workspace_id in (select private.my_workspace_ids()))$p$, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function private.row_md5(j jsonb)
returns text language sql immutable set search_path = '' as $$
  select md5((j - 'updated_at' - 'enrichment_data')::text)
$$;
grant execute on function private.row_md5(jsonb) to authenticated, service_role;

create or replace function private.li_slug(u text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower((regexp_match(coalesce(u,''), 'linkedin\.com/in/([^/?#]+)', 'i'))[1]), '')
$$;
grant execute on function private.li_slug(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Suggest: agency and person match for every row
-- ---------------------------------------------------------------------------
create or replace function public.import_suggest(batch uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  b public.import_batches%rowtype;
  r public.import_rows%rowtype;
  k text; dom text; aid uuid; areason text; asug text;
  cid uuid; csug text; creason text; cagency uuid;
  nm text; em text; slug text;
begin
  select * into b from public.import_batches where id = batch for update;
  if b.id is null then raise exception 'Import not found'; end if;
  if b.status <> 'draft' then raise exception 'This import has already been %', b.status; end if;

  for r in select * from public.import_rows where batch_id = batch order by row_no loop
    -- Agency ---------------------------------------------------------------
    k   := private.agency_name_key(r.mapped->>'company');
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
        if aid is null then
          select a.id into aid from public.agencies a
           where a.workspace_id = b.workspace_id
             and private.agency_loose_key(a.name_key) = private.agency_loose_key(k) limit 1;
          if aid is not null then asug := 'possible'; areason := 'Almost the same name'; end if;
        end if;
        if aid is null and length(private.agency_loose_key(k)) >= 4 then
          select a.id into aid from public.agencies a
           where a.workspace_id = b.workspace_id and length(private.agency_loose_key(a.name_key)) >= 4
             and (private.agency_loose_key(k) like private.agency_loose_key(a.name_key) || '%'
               or private.agency_loose_key(a.name_key) like private.agency_loose_key(k) || '%')
           order by abs(length(a.name_key) - length(k)) limit 1;
          if aid is not null then asug := 'possible'; areason := 'Similar name'; end if;
        end if;
        if aid is null then asug := 'new'; end if;
      end if;
    end if;

    -- Person ---------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Commit: apply every decision atomically
-- ---------------------------------------------------------------------------
create or replace function public.import_commit(batch uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  b   public.import_batches%rowtype;
  r   public.import_rows%rowtype;
  a   public.agencies%rowtype;
  m   jsonb;
  aid uuid; cid uuid; nid uuid;
  created_a boolean; created_c boolean;
  afill jsonb; cfill jsonb;
  pending int;
  v_tier text; v_cat text; v_src text; v_tag text;
  s_new_a int := 0; s_match_a int := 0; s_new_c int := 0; s_upd_c int := 0; s_notes int := 0; s_skip int := 0;
begin
  select * into b from public.import_batches where id = batch for update;
  if b.id is null then raise exception 'Import not found'; end if;
  if b.status <> 'draft' then raise exception 'This import has already been %', b.status; end if;

  select count(*) into pending from public.import_rows
   where batch_id = batch and (agency_action = 'review' or contact_action = 'review'
                               or agency_action is null or contact_action is null);
  if pending > 0 then
    raise exception '% row(s) still need a decision', pending using errcode = 'P0001';
  end if;

  v_tier := nullif(b.defaults->>'tier', '');
  v_cat  := coalesce(nullif(b.defaults->>'category', ''), 'Imported');
  v_src  := nullif(b.defaults->>'source_label', '');
  v_tag  := coalesce(nullif(b.defaults->>'source_tag', ''), 'import');

  for r in select * from public.import_rows where batch_id = batch order by row_no loop
    m := r.mapped; aid := null; cid := null; nid := null;
    created_a := false; created_c := false; afill := null; cfill := null;

    -- Agency ---------------------------------------------------------------
    if r.agency_action = 'new' then
      insert into public.agencies (workspace_id, name, name_key, website, domain, linkedin_url, industry, size_band,
                                   revenue, founded_year, city, country, description, ownership, tier, source)
      values (b.workspace_id, btrim(m->>'company'), private.agency_name_key(m->>'company'),
              nullif(btrim(m->>'website'),''),
              private.domain_from_url(coalesce(nullif(m->>'company_domain',''), m->>'website')),
              nullif(btrim(m->>'company_linkedin_url'),''), nullif(btrim(m->>'company_industry'),''),
              nullif(btrim(m->>'company_size'),''), private.try_int(m->>'company_revenue'),
              case when private.try_int(m->>'company_founded_year') between 1800 and 2100
                   then private.try_int(m->>'company_founded_year')::int end,
              nullif(btrim(m->>'company_city'),''), nullif(btrim(m->>'company_country'),''),
              nullif(btrim(m->>'company_description'),''), nullif(btrim(m->>'ownership'),''),
              v_tier, coalesce(v_src, 'import'))
      on conflict (workspace_id, name_key) do nothing
      returning id into aid;
      if aid is not null then
        created_a := true; s_new_a := s_new_a + 1;
      else
        select id into aid from public.agencies
         where workspace_id = b.workspace_id and name_key = private.agency_name_key(m->>'company');
      end if;
    elsif r.agency_action = 'match' then
      aid := r.agency_id;
      if aid is null then raise exception 'Row % is set to match but has no agency chosen', r.row_no; end if;
      s_match_a := s_match_a + 1;
    end if;

    -- Fill blanks on an existing agency (never overwrite)
    if aid is not null and not created_a then
      select * into a from public.agencies where id = aid;
      afill := jsonb_strip_nulls(jsonb_build_object(
        'website',      case when a.website      is null then nullif(btrim(m->>'website'),'') end,
        'linkedin_url', case when a.linkedin_url is null then nullif(btrim(m->>'company_linkedin_url'),'') end,
        'industry',     case when a.industry     is null then nullif(btrim(m->>'company_industry'),'') end,
        'size_band',    case when a.size_band    is null then nullif(btrim(m->>'company_size'),'') end,
        'city',         case when a.city         is null then nullif(btrim(m->>'company_city'),'') end,
        'country',      case when a.country      is null then nullif(btrim(m->>'company_country'),'') end,
        'description',  case when a.description  is null then nullif(btrim(m->>'company_description'),'') end,
        'ownership',    case when a.ownership    is null then nullif(btrim(m->>'ownership'),'') end));
      if afill <> '{}'::jsonb then
        update public.agencies set
          website = coalesce(website, afill->>'website'), linkedin_url = coalesce(linkedin_url, afill->>'linkedin_url'),
          industry = coalesce(industry, afill->>'industry'), size_band = coalesce(size_band, afill->>'size_band'),
          city = coalesce(city, afill->>'city'), country = coalesce(country, afill->>'country'),
          description = coalesce(description, afill->>'description'), ownership = coalesce(ownership, afill->>'ownership')
        where id = aid;
      else
        afill := null;
      end if;
    end if;
    if aid is not null then select * into a from public.agencies where id = aid; end if;

    -- Person ---------------------------------------------------------------
    if r.contact_action = 'new' and r.agency_action = 'skip' then
      null;  -- skipping the agency skips a new person on the same row
    elsif r.contact_action = 'new' then
      -- Same name already at this agency (e.g. repeated in the file) → treat as update
      select c.id into cid from public.contacts c
       where c.workspace_id = b.workspace_id and lower(btrim(c.name)) = lower(btrim(m->>'name'))
         and c.agency_id is not distinct from aid
       limit 1;
      if cid is null then
        insert into public.contacts (workspace_id, name, email, title, headline, seniority_level, linkedin_url,
                                     city, country, notes, company, website, company_domain, company_linkedin_url,
                                     company_industry, company_size, company_revenue, company_founded_year,
                                     company_city, company_country, company_description, ownership,
                                     category, source, status, replied, bounced)
        values (b.workspace_id, btrim(m->>'name'), nullif(btrim(m->>'email'),''), nullif(btrim(m->>'title'),''),
                nullif(btrim(m->>'headline'),''), nullif(btrim(m->>'seniority_level'),''),
                nullif(btrim(m->>'linkedin_url'),''), nullif(btrim(m->>'city'),''), nullif(btrim(m->>'country'),''),
                nullif(btrim(m->>'notes'),''),
                case when aid is not null then a.name else nullif(btrim(m->>'company'),'') end,
                a.website, a.domain, a.linkedin_url, a.industry, a.size_band, a.revenue, a.founded_year,
                a.city, a.country, a.description, a.ownership,
                v_cat, v_tag, 'Not contacted', false, false)
        returning id into cid;
        created_c := true; s_new_c := s_new_c + 1;
      end if;
    elsif r.contact_action = 'update' then
      cid := coalesce(r.contact_id, r.contact_candidate_id);
      if cid is null then raise exception 'Row % is set to update but has no person chosen', r.row_no; end if;
    end if;

    if cid is not null and not created_c then
      select jsonb_strip_nulls(jsonb_build_object(
        'email',        case when c.email        is null or btrim(c.email) = ''        then nullif(btrim(m->>'email'),'') end,
        'title',        case when c.title        is null or btrim(c.title) = ''        then nullif(btrim(m->>'title'),'') end,
        'headline',     case when c.headline     is null or btrim(c.headline) = ''     then nullif(btrim(m->>'headline'),'') end,
        'linkedin_url', case when c.linkedin_url is null or btrim(c.linkedin_url) = '' then nullif(btrim(m->>'linkedin_url'),'') end,
        'city',         case when c.city         is null or btrim(c.city) = ''         then nullif(btrim(m->>'city'),'') end,
        'country',      case when c.country      is null or btrim(c.country) = ''      then nullif(btrim(m->>'country'),'') end))
        into cfill from public.contacts c where c.id = cid;
      if cfill is not null and cfill <> '{}'::jsonb then
        update public.contacts set
          email = coalesce(nullif(btrim(email),''), cfill->>'email'), title = coalesce(nullif(btrim(title),''), cfill->>'title'),
          headline = coalesce(nullif(btrim(headline),''), cfill->>'headline'),
          linkedin_url = coalesce(nullif(btrim(linkedin_url),''), cfill->>'linkedin_url'),
          city = coalesce(nullif(btrim(city),''), cfill->>'city'), country = coalesce(nullif(btrim(country),''), cfill->>'country')
        where id = cid;
        s_upd_c := s_upd_c + 1;
      else
        cfill := null;
      end if;
    end if;

    -- Note -----------------------------------------------------------------
    if aid is not null and nullif(btrim(m->>'note_text'), '') is not null then
      insert into public.agency_notes (workspace_id, agency_id, contact_id, noted_on, source, body, link, import_batch_id)
      values (b.workspace_id, aid, cid, coalesce(private.try_date(m->>'note_date'), current_date),
              v_src, btrim(m->>'note_text'), nullif(btrim(m->>'note_link'),''), batch)
      returning id into nid;
      s_notes := s_notes + 1;
    end if;

    if r.agency_action = 'skip' and r.contact_action in ('skip','none') then s_skip := s_skip + 1; end if;

    update public.import_rows set
      agency_id = aid, contact_id = cid, note_id = nid,
      created_agency = created_a, created_contact = created_c,
      agency_filled = afill, contact_filled = cfill
    where id = r.id;
  end loop;

  -- Fingerprints for undo: taken after every row is applied.
  update public.import_rows ir set agency_md5 = private.row_md5(to_jsonb(ag))
    from public.agencies ag where ir.batch_id = batch and ir.created_agency and ag.id = ir.agency_id;
  update public.import_rows ir set contact_md5 = private.row_md5(to_jsonb(ct))
    from public.contacts ct where ir.batch_id = batch and ir.created_contact and ct.id = ir.contact_id;

  update public.import_batches set status = 'committed', committed_at = now(),
    summary = jsonb_build_object('new_agencies', s_new_a, 'matched_agencies', s_match_a, 'new_people', s_new_c,
                                 'updated_people', s_upd_c, 'notes', s_notes, 'skipped_rows', s_skip)
  where id = batch;

  return (select summary from public.import_batches where id = batch);
end $$;

-- ---------------------------------------------------------------------------
-- Undo: remove what the import created and reverse what it filled in,
-- except anything edited since (listed in the result).
-- ---------------------------------------------------------------------------
create or replace function public.import_undo(batch uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  b  public.import_batches%rowtype;
  r  public.import_rows%rowtype;
  kept_people text[] := '{}';
  kept_agencies text[] := '{}';
  f text; v text;
  del_c int := 0; del_a int := 0; del_n int := 0;
begin
  select * into b from public.import_batches where id = batch for update;
  if b.id is null then raise exception 'Import not found'; end if;
  if b.status <> 'committed' then raise exception 'Only a committed import can be undone (this one is %)', b.status; end if;

  with d as (delete from public.agency_notes where import_batch_id = batch returning 1)
  select count(*) into del_n from d;

  for r in select * from public.import_rows where batch_id = batch order by row_no desc loop
    -- People created by the import: delete if untouched since
    if r.created_contact and r.contact_id is not null then
      if exists (select 1 from public.contacts c where c.id = r.contact_id and private.row_md5(to_jsonb(c)) = r.contact_md5) then
        delete from public.contacts where id = r.contact_id; del_c := del_c + 1;
      elsif exists (select 1 from public.contacts c where c.id = r.contact_id) then
        kept_people := kept_people || (select c.name from public.contacts c where c.id = r.contact_id);
      end if;
    end if;
    -- Fields filled on existing people: clear if still the imported value
    if r.contact_filled is not null then
      for f, v in select key, value from jsonb_each_text(r.contact_filled) loop
        execute format('update public.contacts set %I = null where id = $1 and %I = $2', f, f) using r.contact_id, v;
      end loop;
    end if;
    -- Fields filled on existing agencies
    if r.agency_filled is not null then
      for f, v in select key, value from jsonb_each_text(r.agency_filled) loop
        execute format('update public.agencies set %I = null where id = $1 and %I = $2', f, f) using r.agency_id, v;
      end loop;
    end if;
  end loop;

  -- Agencies created by the import: delete if untouched and now empty
  for r in select distinct on (agency_id) * from public.import_rows
            where batch_id = batch and created_agency and agency_id is not null loop
    if exists (select 1 from public.agencies a where a.id = r.agency_id and private.row_md5(to_jsonb(a)) = r.agency_md5)
       and not exists (select 1 from public.contacts c where c.agency_id = r.agency_id) then
      delete from public.agencies where id = r.agency_id; del_a := del_a + 1;
    elsif exists (select 1 from public.agencies a where a.id = r.agency_id) then
      kept_agencies := kept_agencies || (select a.name from public.agencies a where a.id = r.agency_id);
    end if;
  end loop;

  update public.import_batches set status = 'undone', undone_at = now(),
    summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('undo', jsonb_build_object(
      'removed_people', del_c, 'removed_agencies', del_a, 'removed_notes', del_n,
      'kept_people', to_jsonb(kept_people), 'kept_agencies', to_jsonb(kept_agencies)))
  where id = batch;

  return (select summary->'undo' from public.import_batches where id = batch);
end $$;

revoke all on function public.import_suggest(uuid), public.import_commit(uuid), public.import_undo(uuid) from public, anon;
grant execute on function public.import_suggest(uuid), public.import_commit(uuid), public.import_undo(uuid) to authenticated;
