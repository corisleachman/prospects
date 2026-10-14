-- ============================================================================
-- STEP 3B: researcher evidence intake
--
-- Adds one authenticated, transaction-safe RPC for the existing Research queue.
-- It stores immutable evidence and the researcher's explicit agency/contact match.
-- It does not classify evidence, create a campaign signal or send outreach.
-- ============================================================================

-- The dashboard already depends on authenticated contact reads in production,
-- but the prehistory schema relied on Supabase's former default grants. Record
-- the minimum privilege this invoker function needs for clean branch replays.
grant select on public.contacts to authenticated;
grant insert on public.entity_matches to authenticated;

create policy "research team adds researcher matches"
  on public.entity_matches
  for insert to authenticated
  with check (
    match_method = 'researcher'
    and confidence = 1
    and confidence_level = 'high'
    and decision = 'accepted'
    and decided_by = (select auth.uid())
    and decided_at is not null
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'reviewer', 'researcher', 'client_admin']::text[]
    ))
  );

create or replace function public.submit_researcher_evidence(
  p_contact_id uuid,
  p_source_url text,
  p_excerpt text,
  p_title text default null,
  p_published_at timestamptz default null,
  p_researcher_confidence text default null
)
returns table (
  evidence_item_id uuid,
  entity_match_id uuid,
  duplicate boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_agency_id uuid;
  v_url text := pg_catalog.btrim(p_source_url);
  v_canonical_url text;
  v_excerpt text := pg_catalog.btrim(p_excerpt);
  v_title text := nullif(pg_catalog.btrim(p_title), '');
  v_source_family text;
  v_url_hash text;
  v_content_hash text;
  v_evidence_item_id uuid;
  v_entity_match_id uuid;
  v_duplicate boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in before saving evidence';
  end if;

  if p_contact_id is null then
    raise exception using errcode = '22023', message = 'Choose a contact before saving evidence';
  end if;

  if v_url is null or v_url = '' or v_url !~* '^https?://[^[:space:]]+$' then
    raise exception using errcode = '22023', message = 'Enter a complete http or https source URL';
  end if;

  if pg_catalog.char_length(v_url) > 2048 then
    raise exception using errcode = '22023', message = 'Source URL is too long';
  end if;

  if v_excerpt is null or v_excerpt = '' then
    raise exception using errcode = '22023', message = 'Add a short factual evidence summary';
  end if;

  if pg_catalog.char_length(v_excerpt) > 5000 then
    raise exception using errcode = '22023', message = 'Evidence summary must be 5,000 characters or fewer';
  end if;

  if v_title is not null and pg_catalog.char_length(v_title) > 500 then
    raise exception using errcode = '22023', message = 'Evidence title must be 500 characters or fewer';
  end if;

  if p_researcher_confidence is not null
     and p_researcher_confidence not in ('strong', 'maybe', 'nothing') then
    raise exception using errcode = '22023', message = 'Evidence confidence is invalid';
  end if;

  select c.workspace_id, c.agency_id
    into v_workspace_id, v_agency_id
    from public.contacts c
    where c.id = p_contact_id;

  if not found then
    raise exception using errcode = '42501', message = 'Contact is unavailable in your workspace';
  end if;

  if v_agency_id is null then
    raise exception using errcode = '23514', message = 'Link this contact to an agency before saving evidence';
  end if;

  if not (select private.has_workspace_role(
    v_workspace_id, array['owner', 'reviewer', 'researcher', 'client_admin']::text[]
  )) then
    raise exception using errcode = '42501', message = 'Your workspace role cannot submit evidence';
  end if;

  -- Fragments and query parameters normally identify tracking or page state,
  -- not a different public source. Content remains part of the dedupe key.
  v_canonical_url := pg_catalog.regexp_replace(v_url, '[?#].*$', '');
  if v_canonical_url !~* '^https?://[^/]+/$' then
    v_canonical_url := pg_catalog.regexp_replace(v_canonical_url, '/+$', '');
  end if;

  v_source_family := case
    when v_canonical_url ~* '^https?://([^/]+\.)?linkedin\.com/' then 'linkedin'
    else 'manual'
  end;
  v_url_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical_url, 'UTF8')),
    'hex'
  );
  v_content_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.lower(pg_catalog.regexp_replace(
        v_excerpt,
        '[[:space:]]+', ' ', 'g'
      )),
      'UTF8'
    )),
    'hex'
  );

  insert into public.evidence_items (
    workspace_id, source_family, provider_key,
    source_url, canonical_url, canonical_url_hash,
    title, excerpt, content_hash,
    published_at, published_date_known,
    submission_route, submitted_by, researcher_confidence,
    factual_notes, capture_metadata
  )
  values (
    v_workspace_id, v_source_family, 'researcher',
    v_url, v_canonical_url, v_url_hash,
    v_title, v_excerpt, v_content_hash,
    p_published_at, p_published_at is not null,
    'researcher', v_user_id, p_researcher_confidence,
    v_excerpt,
    pg_catalog.jsonb_build_object(
      'submitted_from', 'research_queue',
      'contact_id', p_contact_id
    )
  )
  on conflict (workspace_id, canonical_url_hash, content_hash)
    where source_external_id is null
  do nothing
  returning id into v_evidence_item_id;

  if v_evidence_item_id is null then
    v_duplicate := true;
    select e.id
      into v_evidence_item_id
      from public.evidence_items e
      where e.workspace_id = v_workspace_id
        and e.canonical_url_hash = v_url_hash
        and e.content_hash = v_content_hash
        and e.source_external_id is null
      order by e.created_at
      limit 1;
  end if;

  if v_evidence_item_id is null then
    raise exception 'Evidence could not be saved';
  end if;

  insert into public.entity_matches (
    workspace_id, evidence_item_id, agency_id, contact_id,
    match_method, confidence, confidence_level, reasons,
    decision, decided_by, decided_at
  )
  values (
    v_workspace_id, v_evidence_item_id, v_agency_id, p_contact_id,
    'researcher', 1, 'high',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type', 'researcher_selected_contact'
    )),
    'accepted', v_user_id, pg_catalog.now()
  )
  on conflict do nothing
  returning id into v_entity_match_id;

  if v_entity_match_id is null then
    select m.id
      into v_entity_match_id
      from public.entity_matches m
      where m.evidence_item_id = v_evidence_item_id
        and m.workspace_id = v_workspace_id
        and m.agency_id = v_agency_id
        and m.contact_id = p_contact_id
      limit 1;
  end if;

  return query select v_evidence_item_id, v_entity_match_id, v_duplicate;
end
$$;

revoke all on function public.submit_researcher_evidence(
  uuid, text, text, text, timestamptz, text
) from public, anon;
grant execute on function public.submit_researcher_evidence(
  uuid, text, text, text, timestamptz, text
) to authenticated;
