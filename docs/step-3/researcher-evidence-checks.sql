-- Step 3b verification. Run only after the researcher-evidence migration has
-- been applied to an isolated database or Supabase development branch.
-- Everything created here is rolled back.

begin;

do $$
declare
  rpc_oid regprocedure := to_regprocedure(
    'public.submit_researcher_evidence(uuid,text,text,text,timestamp with time zone,text)'
  );
begin
  if rpc_oid is null then
    raise exception 'Researcher evidence RPC is missing';
  end if;

  if (select p.prosecdef from pg_proc p where p.oid = rpc_oid) then
    raise exception 'Researcher evidence RPC must use security invoker';
  end if;

  if has_function_privilege('anon', rpc_oid, 'execute') then
    raise exception 'Anonymous users can execute the researcher evidence RPC';
  end if;

  if not has_function_privilege('authenticated', rpc_oid, 'execute') then
    raise exception 'Authenticated users cannot execute the researcher evidence RPC';
  end if;

  if not has_table_privilege('authenticated', 'public.entity_matches', 'insert') then
    raise exception 'Authenticated role is missing entity-match insert permission';
  end if;

  if not has_table_privilege('authenticated', 'public.contacts', 'select') then
    raise exception 'Authenticated role is missing contact read permission';
  end if;
end
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '40000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'step3b-owner-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '40000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'step3b-researcher-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.workspaces (id, name, slug)
values
  ('41000000-0000-0000-0000-000000000001', 'Step 3B workspace A', 'step3b-a'),
  ('41000000-0000-0000-0000-000000000002', 'Step 3B workspace B', 'step3b-b');

insert into public.workspace_members (workspace_id, user_id, role, is_default)
values
  (
    '41000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'owner', true
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    'researcher', true
  );

insert into public.agencies (id, workspace_id, name, name_key, tier)
values
  (
    '42000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001',
    'Step 3B Agency A', 'step3bagencya', 'focus'
  ),
  (
    '42000000-0000-0000-0000-000000000002',
    '41000000-0000-0000-0000-000000000002',
    'Step 3B Agency B', 'step3bagencyb', 'focus'
  );

insert into public.contacts (id, workspace_id, name, company, title, agency_id)
values
  (
    '43000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001',
    'Step 3B Contact A', 'Step 3B Agency A', 'Founder',
    '42000000-0000-0000-0000-000000000001'
  ),
  (
    '43000000-0000-0000-0000-000000000002',
    '41000000-0000-0000-0000-000000000002',
    'Step 3B Contact B', 'Step 3B Agency B', 'Founder',
    '42000000-0000-0000-0000-000000000002'
  );

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  first_result record;
  duplicate_result record;
begin
  select * into first_result
  from public.submit_researcher_evidence(
    '43000000-0000-0000-0000-000000000001',
    'https://example.invalid/news/growth/?utm_source=test#section',
    'Agency A announced a new commercial leadership hire.',
    'Agency A expands its commercial team',
    '2026-10-12 09:00:00+00',
    'strong'
  );

  if first_result.evidence_item_id is null
     or first_result.entity_match_id is null
     or first_result.duplicate then
    raise exception 'First researcher submission returned an invalid result';
  end if;

  if not exists (
    select 1
    from public.evidence_items e
    where e.id = first_result.evidence_item_id
      and e.workspace_id = '41000000-0000-0000-0000-000000000001'
      and e.canonical_url = 'https://example.invalid/news/growth'
      and e.source_family = 'manual'
      and e.provider_key = 'researcher'
      and e.submission_route = 'researcher'
      and e.submitted_by = '40000000-0000-0000-0000-000000000001'
      and e.researcher_confidence = 'strong'
      and e.published_date_known
  ) then
    raise exception 'Researcher evidence was not normalized correctly';
  end if;

  if not exists (
    select 1
    from public.entity_matches m
    where m.id = first_result.entity_match_id
      and m.workspace_id = '41000000-0000-0000-0000-000000000001'
      and m.agency_id = '42000000-0000-0000-0000-000000000001'
      and m.contact_id = '43000000-0000-0000-0000-000000000001'
      and m.match_method = 'researcher'
      and m.confidence = 1
      and m.confidence_level = 'high'
      and m.decision = 'accepted'
      and m.decided_by = '40000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Researcher entity match was not created correctly';
  end if;

  select * into duplicate_result
  from public.submit_researcher_evidence(
    '43000000-0000-0000-0000-000000000001',
    'https://example.invalid/news/growth?utm_campaign=repeat',
    'Agency A announced a new commercial leadership hire.',
    'A different display title does not change the evidence',
    '2026-10-12 09:00:00+00',
    'strong'
  );

  if not duplicate_result.duplicate
     or duplicate_result.evidence_item_id <> first_result.evidence_item_id
     or duplicate_result.entity_match_id <> first_result.entity_match_id then
    raise exception 'Repeated researcher evidence was not deduplicated';
  end if;

  if (select count(*) from public.evidence_items) <> 1
     or (select count(*) from public.entity_matches) <> 1 then
    raise exception 'Duplicate submission created extra records';
  end if;

  begin
    perform public.submit_researcher_evidence(
      '43000000-0000-0000-0000-000000000002',
      'https://example.invalid/cross-workspace',
      'This insert must not be accepted.',
      null, null, 'maybe'
    );
    raise exception using errcode = 'ZX101', message = 'Cross-workspace submission was accepted';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result record;
begin
  select * into result
  from public.submit_researcher_evidence(
    '43000000-0000-0000-0000-000000000002',
    'https://www.linkedin.com/posts/example-123?trackingId=test',
    'Contact B described a specific growth constraint.',
    null, null, 'maybe'
  );

  if result.evidence_item_id is null or result.entity_match_id is null then
    raise exception 'Researcher role could not submit evidence in its workspace';
  end if;

  if not exists (
    select 1 from public.evidence_items e
    where e.id = result.evidence_item_id
      and e.source_family = 'linkedin'
      and not e.published_date_known
  ) then
    raise exception 'LinkedIn researcher evidence was not normalized correctly';
  end if;
end
$$;

reset role;
rollback;

-- Expected result: every assertion passes and all synthetic records disappear.
