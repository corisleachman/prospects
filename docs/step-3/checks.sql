-- Step 3a verification. Run only after the Step 3a migration has been applied
-- to an isolated database or Supabase development branch.
--
-- The script creates synthetic users and records inside one transaction,
-- exercises RLS as two authenticated users, and rolls everything back.

begin;

-- ---------------------------------------------------------------------------
-- Static schema checks
-- ---------------------------------------------------------------------------

do $$
declare
  expected_tables constant text[] := array[
    'campaigns', 'campaign_prospects', 'signal_definitions',
    'campaign_signal_rules', 'campaign_source_rules', 'search_runs',
    'source_tasks', 'evidence_items', 'provider_payloads', 'entity_matches',
    'signals', 'signal_sources', 'campaign_signals'
  ];
  missing_tables integer;
  rls_disabled integer;
  anon_grants integer;
begin
  select count(*)
    into missing_tables
    from unnest(expected_tables) as expected(table_name)
    where to_regclass('public.' || expected.table_name) is null;
  if missing_tables <> 0 then
    raise exception 'Step 3a tables missing: %', missing_tables;
  end if;

  select count(*)
    into rls_disabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(expected_tables)
      and not c.relrowsecurity;
  if rls_disabled <> 0 then
    raise exception 'Step 3a tables without RLS: %', rls_disabled;
  end if;

  select count(*)
    into anon_grants
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = any(expected_tables)
      and g.grantee = 'anon';
  if anon_grants <> 0 then
    raise exception 'Unexpected anon grants on Step 3a tables: %', anon_grants;
  end if;

  if (select count(*) from public.signal_definitions where workspace_id is null) <> 15 then
    raise exception 'Expected 15 global signal definitions';
  end if;

  if not exists (
    select 1 from public.campaigns
    where name = 'UK independent agencies - founders' and status = 'draft'
  ) then
    raise exception 'Draft pilot campaign missing';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Synthetic users and tenant data
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'step3a-owner-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'step3a-researcher-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.workspaces (id, name, slug)
values
  ('31000000-0000-0000-0000-000000000001', 'Step 3A workspace A', 'step3a-a'),
  ('31000000-0000-0000-0000-000000000002', 'Step 3A workspace B', 'step3a-b');

insert into public.workspace_members (workspace_id, user_id, role, is_default)
values
  (
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'owner', true
  ),
  (
    '31000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    'researcher', true
  );

insert into public.agencies (id, workspace_id, name, name_key, tier)
values
  ('32000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Step 3A Agency A', 'step3aagencya', 'focus'),
  ('32000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', 'Step 3A Agency B', 'step3aagencyb', 'focus');

insert into public.contacts (id, workspace_id, name, company, title, agency_id)
values
  (
    '33000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'Step 3A Contact A', 'Step 3A Agency A', 'Founder',
    '32000000-0000-0000-0000-000000000001'
  ),
  (
    '33000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    'Step 3A Contact B', 'Step 3A Agency B', 'Founder',
    '32000000-0000-0000-0000-000000000002'
  );

insert into public.campaigns (
  id, workspace_id, name, objective, owner_user_id
)
values
  (
    '34000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'Step 3A Campaign A', 'Isolation test campaign A',
    '30000000-0000-0000-0000-000000000001'
  ),
  (
    '34000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    'Step 3A Campaign B', 'Isolation test campaign B', null
  );

insert into public.campaign_prospects (
  id, workspace_id, campaign_id, agency_id, contact_id, group_type
)
values
  (
    '35000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '34000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001',
    'watchlist'
  ),
  (
    '35000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '34000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002',
    '33000000-0000-0000-0000-000000000002',
    'watchlist'
  );

insert into public.search_runs (
  id, workspace_id, campaign_id, run_type, idempotency_key, status
)
values
  (
    '36000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '34000000-0000-0000-0000-000000000001',
    'manual', 'step3a-run-a', 'succeeded'
  ),
  (
    '36000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '34000000-0000-0000-0000-000000000002',
    'manual', 'step3a-run-b', 'succeeded'
  );

insert into public.source_tasks (
  id, workspace_id, run_id, task_key, source_family, provider_key, status
)
values
  (
    '37000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '36000000-0000-0000-0000-000000000001',
    'step3a-task-a', 'web_search', 'test-provider', 'succeeded'
  ),
  (
    '37000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '36000000-0000-0000-0000-000000000002',
    'step3a-task-b', 'web_search', 'test-provider', 'succeeded'
  );

insert into public.evidence_items (
  id, workspace_id, source_task_id, source_family, provider_key,
  source_external_id, source_url, canonical_url, canonical_url_hash,
  source_name, title, excerpt, content_hash, published_at,
  published_date_known, submission_route
)
values
  (
    '38000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '37000000-0000-0000-0000-000000000001',
    'web_search', 'test-provider', 'provider-item-a',
    'https://example.invalid/a?utm_source=test', 'https://example.invalid/a',
    repeat('a', 64), 'Test source', 'Test event A', 'Agency A announced a new service.',
    repeat('b', 64), now(), true, 'automated'
  ),
  (
    '38000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '37000000-0000-0000-0000-000000000002',
    'web_search', 'test-provider', 'provider-item-b',
    'https://example.invalid/b', 'https://example.invalid/b',
    repeat('c', 64), 'Test source', 'Test event B', 'Agency B announced a new service.',
    repeat('d', 64), now(), true, 'automated'
  ),
  (
    '38000000-0000-0000-0000-000000000003',
    '31000000-0000-0000-0000-000000000001',
    null, 'monitored_page', 'test-monitor', null,
    'https://example.invalid/a/services', 'https://example.invalid/a/services',
    repeat('e', 64), 'Agency A', 'Services', 'First captured version.',
    repeat('1', 64), null, false, 'automated'
  ),
  (
    '38000000-0000-0000-0000-000000000004',
    '31000000-0000-0000-0000-000000000001',
    null, 'monitored_page', 'test-monitor', null,
    'https://example.invalid/a/services', 'https://example.invalid/a/services',
    repeat('e', 64), 'Agency A', 'Services', 'Second captured version.',
    repeat('2', 64), null, false, 'automated'
  );

insert into public.provider_payloads (
  id, workspace_id, source_task_id, evidence_item_id, payload
)
values
  (
    '39000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '37000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001',
    '{"test":true}'::jsonb
  ),
  (
    '39000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '37000000-0000-0000-0000-000000000002',
    '38000000-0000-0000-0000-000000000002',
    '{"test":true}'::jsonb
  );

insert into public.entity_matches (
  id, workspace_id, evidence_item_id, agency_id, contact_id,
  match_method, confidence, confidence_level, decision, decided_by, decided_at
)
values
  (
    '3a000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001',
    'test', 1, 'high', 'accepted',
    '30000000-0000-0000-0000-000000000001', now()
  ),
  (
    '3a000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '38000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002',
    '33000000-0000-0000-0000-000000000002',
    'test', 1, 'high', 'accepted',
    '30000000-0000-0000-0000-000000000002', now()
  );

insert into public.signals (
  id, workspace_id, agency_id, signal_definition_id, event_date,
  event_date_precision, factual_summary, event_fingerprint,
  primary_evidence_item_id, classification_confidence
)
values
  (
    '3b000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000001',
    (select id from public.signal_definitions where workspace_id is null and key = 'offer_development'),
    current_date, 'day', 'Agency A announced a new service.', repeat('3', 64),
    '38000000-0000-0000-0000-000000000001', 1
  ),
  (
    '3b000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002',
    (select id from public.signal_definitions where workspace_id is null and key = 'offer_development'),
    current_date, 'day', 'Agency B announced a new service.', repeat('4', 64),
    '38000000-0000-0000-0000-000000000002', 1
  );

insert into public.signal_sources (workspace_id, signal_id, evidence_item_id, is_primary)
values
  (
    '31000000-0000-0000-0000-000000000001',
    '3b000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001', true
  ),
  (
    '31000000-0000-0000-0000-000000000001',
    '3b000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000003', false
  ),
  (
    '31000000-0000-0000-0000-000000000002',
    '3b000000-0000-0000-0000-000000000002',
    '38000000-0000-0000-0000-000000000002', true
  );

insert into public.campaign_signals (
  id, workspace_id, campaign_id, signal_id, contact_id, entity_match_id,
  event_specificity_score, evidence_strength_score,
  commercial_relevance_score, timing_score, contact_value_score,
  identity_confidence, qualification_state
)
values
  (
    '3c000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '34000000-0000-0000-0000-000000000001',
    '3b000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-000000000001',
    2, 2, 2, 2, 2, 'high', 'ready'
  ),
  (
    '3c000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002',
    '34000000-0000-0000-0000-000000000002',
    '3b000000-0000-0000-0000-000000000002',
    '33000000-0000-0000-0000-000000000002',
    '3a000000-0000-0000-0000-000000000002',
    2, 2, 2, 2, 2, 'high', 'ready'
  );

-- Provider-item dedupe must reject a retry in the same workspace.
do $$
begin
  begin
    insert into public.evidence_items (
      workspace_id, source_task_id, source_family, provider_key,
      source_external_id, source_url, canonical_url, canonical_url_hash,
      excerpt, content_hash, published_at, published_date_known, submission_route
    )
    values (
      '31000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      'web_search', 'test-provider', 'provider-item-a',
      'https://example.invalid/retry', 'https://example.invalid/retry',
      repeat('f', 64), 'Duplicate provider item.', repeat('5', 64),
      now(), true, 'automated'
    );
    raise exception using errcode = 'ZX001', message = 'Provider-item duplicate was accepted';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Captured evidence must be immutable.
do $$
begin
  begin
    update public.evidence_items
      set excerpt = 'Changed'
      where id = '38000000-0000-0000-0000-000000000001';
    raise exception using errcode = 'ZX002', message = 'Evidence update was accepted';
  exception
    when others then
      if sqlerrm <> 'Evidence items are immutable' then
        raise;
      end if;
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- Workspace A owner
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  changed integer;
begin
  if (select count(*) from public.campaigns where name like 'Step 3A Campaign%') <> 1 then
    raise exception 'Workspace A campaign isolation failed';
  end if;
  if (select count(*) from public.evidence_items where source_name = 'Test source') <> 1 then
    raise exception 'Workspace A evidence isolation failed';
  end if;
  if (select count(*) from public.provider_payloads) <> 1 then
    raise exception 'Workspace A owner payload access failed';
  end if;
  if (select count(*) from public.signal_definitions where workspace_id is null) <> 15 then
    raise exception 'Workspace A cannot read global definitions';
  end if;

  insert into public.campaigns (workspace_id, name, objective)
  values (
    '31000000-0000-0000-0000-000000000001',
    'Step 3A owner-created campaign',
    'Allowed owner insert'
  );

  update public.campaign_signals
    set queue_state = 'saved'
    where id = '3c000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Workspace A owner could not review own campaign signal';
  end if;

  begin
    insert into public.campaigns (workspace_id, name, objective)
    values (
      '31000000-0000-0000-0000-000000000002',
      'Step 3A cross-workspace campaign',
      'Must fail'
    );
    raise exception using errcode = 'ZX003', message = 'Cross-workspace campaign insert was accepted';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Workspace B researcher
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  changed integer;
begin
  if (select count(*) from public.campaigns where name like 'Step 3A Campaign%') <> 1 then
    raise exception 'Workspace B campaign isolation failed';
  end if;
  if (select count(*) from public.provider_payloads) <> 0 then
    raise exception 'Researcher can read provider payloads';
  end if;

  insert into public.evidence_items (
    workspace_id, source_family, provider_key, source_url, canonical_url,
    canonical_url_hash, excerpt, content_hash, published_at,
    published_date_known, submission_route, submitted_by,
    researcher_confidence, factual_notes
  )
  values (
    '31000000-0000-0000-0000-000000000002',
    'manual', 'researcher', 'https://example.invalid/manual-b',
    'https://example.invalid/manual-b', repeat('6', 64),
    'Researcher-submitted evidence.', repeat('7', 64), now(), true,
    'researcher', '30000000-0000-0000-0000-000000000002',
    'strong', 'Factual note'
  );

  begin
    insert into public.campaigns (workspace_id, name, objective)
    values (
      '31000000-0000-0000-0000-000000000002',
      'Step 3A researcher campaign',
      'Must fail'
    );
    raise exception using errcode = 'ZX004', message = 'Researcher campaign insert was accepted';
  exception
    when insufficient_privilege then null;
  end;

  update public.campaign_signals
    set queue_state = 'saved'
    where id = '3c000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'Researcher changed a campaign signal';
  end if;

  update public.entity_matches
    set decision = 'rejected'
    where id = '3a000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Researcher could not decide own entity match';
  end if;
end
$$;

reset role;

rollback;

-- Expected final output: COMMIT is never issued and every synthetic record is
-- rolled back. Any failed assertion aborts the script with a clear exception.
