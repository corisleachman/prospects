-- ============================================================================
-- STEP 3A: campaign and unified evidence foundation
--
-- This migration adds schema, access rules and a draft pilot configuration.
-- It does not change the existing Signals modal, run a collector, generate a
-- message or migrate legacy signal rows.
-- ============================================================================

-- New foreign keys include workspace_id so a privileged or faulty writer
-- cannot attach a record to an agency or contact in another workspace.
alter table public.agencies
  add constraint agencies_id_workspace_unique unique (id, workspace_id);

alter table public.contacts
  add constraint contacts_id_workspace_unique unique (id, workspace_id);

-- Role lookup for write policies. Keep membership data out of JWT metadata so
-- a suspended member loses access immediately.
create or replace function private.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)
  )
$$;

revoke all on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Campaign configuration
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces(id) on delete restrict,
  name                      text not null check (btrim(name) <> ''),
  objective                 text not null default '',
  status                    text not null default 'draft'
                            check (status in ('draft', 'active', 'paused', 'archived')),
  owner_user_id             uuid references auth.users(id) on delete set null,
  freshness_days            integer not null default 14 check (freshness_days between 1 and 90),
  cooldown_days             integer not null default 30 check (cooldown_days between 0 and 365),
  weight                    numeric(8,4) not null default 1 check (weight > 0),
  daily_target              integer not null default 25 check (daily_target between 0 and 100),
  discovery_daily_limit     integer not null default 0 check (discovery_daily_limit between 0 and 3),
  daily_cost_limit_usd      numeric(10,4) not null default 0 check (daily_cost_limit_usd >= 0),
  schedule                  jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(schedule) = 'object'),
  timezone                  text not null default 'Europe/London',
  created_by                uuid references auth.users(id) on delete set null default auth.uid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,
  unique (id, workspace_id),
  check ((status = 'archived') = (archived_at is not null))
);

create unique index campaigns_workspace_name_unique
  on public.campaigns (workspace_id, lower(btrim(name)));
create index campaigns_workspace_status_idx
  on public.campaigns (workspace_id, status, updated_at desc);
create index campaigns_owner_idx
  on public.campaigns (owner_user_id)
  where owner_user_id is not null;
create index campaigns_created_by_idx
  on public.campaigns (created_by)
  where created_by is not null;

create trigger touch_updated_at
  before update on public.campaigns
  for each row execute function private.touch_updated_at();

create table public.campaign_prospects (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  campaign_id           uuid not null,
  agency_id             uuid not null,
  contact_id            uuid,
  group_type            text not null default 'rotating'
                        check (group_type in ('watchlist', 'rotating', 'suppressed')),
  priority              smallint not null default 0 check (priority between -100 and 100),
  suppression_reason    text,
  last_scanned_at       timestamptz,
  next_eligible_at      timestamptz,
  added_by              uuid references auth.users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (campaign_id, workspace_id)
    references public.campaigns(id, workspace_id) on delete cascade,
  foreign key (agency_id, workspace_id)
    references public.agencies(id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete cascade,
  check ((group_type = 'suppressed') = (suppression_reason is not null))
);

create unique index campaign_prospects_contact_unique
  on public.campaign_prospects (campaign_id, contact_id)
  where contact_id is not null;
create unique index campaign_prospects_agency_only_unique
  on public.campaign_prospects (campaign_id, agency_id)
  where contact_id is null;
create index campaign_prospects_eligible_idx
  on public.campaign_prospects (campaign_id, group_type, next_eligible_at, priority desc)
  where group_type <> 'suppressed';
create index campaign_prospects_workspace_idx
  on public.campaign_prospects (workspace_id);
create index campaign_prospects_campaign_idx
  on public.campaign_prospects (campaign_id, workspace_id);
create index campaign_prospects_agency_idx
  on public.campaign_prospects (agency_id, workspace_id);
create index campaign_prospects_contact_idx
  on public.campaign_prospects (contact_id, workspace_id)
  where contact_id is not null;
create index campaign_prospects_added_by_idx
  on public.campaign_prospects (added_by)
  where added_by is not null;

create or replace function private.set_campaign_prospect_agency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_agency_id uuid;
begin
  if new.contact_id is not null then
    select c.agency_id
      into linked_agency_id
      from public.contacts c
      where c.id = new.contact_id
        and c.workspace_id = new.workspace_id;

    if linked_agency_id is null then
      raise exception 'Campaign contact must belong to an agency in the same workspace';
    end if;

    new.agency_id := linked_agency_id;
  end if;
  return new;
end
$$;

revoke all on function private.set_campaign_prospect_agency() from public;

create trigger b10_set_campaign_prospect_agency
  before insert or update of contact_id, agency_id, workspace_id
  on public.campaign_prospects
  for each row execute function private.set_campaign_prospect_agency();

create trigger touch_updated_at
  before update on public.campaign_prospects
  for each row execute function private.touch_updated_at();

create table public.signal_definitions (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid references public.workspaces(id) on delete cascade,
  key                        text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label                      text not null check (btrim(label) <> ''),
  description                text not null default '',
  polarity                   text check (polarity is null or polarity in ('opportunity', 'pressure', 'intent', 'perspective')),
  positive_examples          jsonb not null default '[]'::jsonb
                             check (jsonb_typeof(positive_examples) = 'array'),
  false_positive_guidance    text not null default '',
  is_legacy                  boolean not null default false,
  is_active                  boolean not null default true,
  created_by                 uuid references auth.users(id) on delete set null default auth.uid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index signal_definitions_global_key_unique
  on public.signal_definitions (key)
  where workspace_id is null;
create unique index signal_definitions_workspace_key_unique
  on public.signal_definitions (workspace_id, key)
  where workspace_id is not null;
create index signal_definitions_workspace_idx
  on public.signal_definitions (workspace_id)
  where workspace_id is not null;
create index signal_definitions_created_by_idx
  on public.signal_definitions (created_by)
  where created_by is not null;

create trigger touch_updated_at
  before update on public.signal_definitions
  for each row execute function private.touch_updated_at();

create table public.campaign_signal_rules (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete restrict,
  campaign_id              uuid not null,
  signal_definition_id     uuid not null references public.signal_definitions(id) on delete restrict,
  enabled                  boolean not null default true,
  minimum_score            smallint not null default 7 check (minimum_score between 0 and 10),
  strategy                 text,
  cta_rule                 text,
  requires_owner_approval  boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (campaign_id, workspace_id)
    references public.campaigns(id, workspace_id) on delete cascade,
  unique (campaign_id, signal_definition_id)
);

create index campaign_signal_rules_workspace_idx
  on public.campaign_signal_rules (workspace_id);
create index campaign_signal_rules_campaign_idx
  on public.campaign_signal_rules (campaign_id, workspace_id);
create index campaign_signal_rules_definition_idx
  on public.campaign_signal_rules (signal_definition_id);

create trigger touch_updated_at
  before update on public.campaign_signal_rules
  for each row execute function private.touch_updated_at();

create table public.campaign_source_rules (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete restrict,
  campaign_id        uuid not null,
  source_family      text not null check (source_family in (
                       'web_search', 'monitored_page', 'publication', 'public_social',
                       'linkedin', 'manual'
                     )),
  provider_key       text,
  enabled            boolean not null default true,
  include_rules      jsonb not null default '{}'::jsonb check (jsonb_typeof(include_rules) = 'object'),
  exclude_rules      jsonb not null default '{}'::jsonb check (jsonb_typeof(exclude_rules) = 'object'),
  scan_interval_days integer not null default 1 check (scan_interval_days between 1 and 90),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (campaign_id, workspace_id)
    references public.campaigns(id, workspace_id) on delete cascade
);

create unique index campaign_source_rules_key_unique
  on public.campaign_source_rules (campaign_id, source_family, coalesce(provider_key, ''));
create index campaign_source_rules_workspace_idx
  on public.campaign_source_rules (workspace_id);
create index campaign_source_rules_campaign_idx
  on public.campaign_source_rules (campaign_id, workspace_id);

create trigger touch_updated_at
  before update on public.campaign_source_rules
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Runs and retryable source tasks
-- ---------------------------------------------------------------------------

create table public.search_runs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete restrict,
  campaign_id        uuid,
  parent_run_id      uuid,
  run_type           text not null check (run_type in ('scheduled', 'find_more', 'manual', 'legacy_scan')),
  idempotency_key    text not null check (btrim(idempotency_key) <> ''),
  status             text not null default 'queued'
                     check (status in ('queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled')),
  input_scope        jsonb not null default '{}'::jsonb check (jsonb_typeof(input_scope) = 'object'),
  new_count          integer not null default 0 check (new_count >= 0),
  duplicate_count    integer not null default 0 check (duplicate_count >= 0),
  stale_count        integer not null default 0 check (stale_count >= 0),
  weak_count         integer not null default 0 check (weak_count >= 0),
  ambiguous_count    integer not null default 0 check (ambiguous_count >= 0),
  estimated_cost_usd numeric(12,4) not null default 0 check (estimated_cost_usd >= 0),
  actual_cost_usd    numeric(12,4) not null default 0 check (actual_cost_usd >= 0),
  requested_by       uuid references auth.users(id) on delete set null,
  started_at         timestamptz,
  completed_at       timestamptz,
  error_summary      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key),
  foreign key (campaign_id, workspace_id)
    references public.campaigns(id, workspace_id) on delete cascade,
  foreign key (parent_run_id, workspace_id)
    references public.search_runs(id, workspace_id) on delete cascade,
  check (parent_run_id is null or parent_run_id <> id),
  check (campaign_id is not null or parent_run_id is null),
  check (completed_at is null or started_at is not null)
);

create index search_runs_workspace_status_idx
  on public.search_runs (workspace_id, status, created_at desc);
create index search_runs_campaign_idx
  on public.search_runs (campaign_id, workspace_id, created_at desc)
  where campaign_id is not null;
create index search_runs_parent_idx
  on public.search_runs (parent_run_id, workspace_id)
  where parent_run_id is not null;
create index search_runs_requested_by_idx
  on public.search_runs (requested_by)
  where requested_by is not null;

create trigger touch_updated_at
  before update on public.search_runs
  for each row execute function private.touch_updated_at();

create table public.source_tasks (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete restrict,
  run_id              uuid not null,
  task_key            text not null check (btrim(task_key) <> ''),
  source_family       text not null check (source_family in (
                        'web_search', 'monitored_page', 'publication', 'public_social',
                        'linkedin', 'manual'
                      )),
  provider_key        text not null check (btrim(provider_key) <> ''),
  input               jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  provider_reference  text,
  status              text not null default 'queued'
                      check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count       integer not null default 0 check (attempt_count >= 0),
  estimated_cost_usd  numeric(12,4) not null default 0 check (estimated_cost_usd >= 0),
  actual_cost_usd     numeric(12,4) not null default 0 check (actual_cost_usd >= 0),
  error_code          text,
  error_summary       text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, workspace_id),
  unique (run_id, task_key),
  foreign key (run_id, workspace_id)
    references public.search_runs(id, workspace_id) on delete cascade,
  check (completed_at is null or started_at is not null)
);

create index source_tasks_workspace_status_idx
  on public.source_tasks (workspace_id, status, created_at);
create index source_tasks_run_idx
  on public.source_tasks (run_id, workspace_id);
create index source_tasks_provider_ref_idx
  on public.source_tasks (provider_key, provider_reference)
  where provider_reference is not null;

create trigger touch_updated_at
  before update on public.source_tasks
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable evidence and entity matching
-- ---------------------------------------------------------------------------

create table public.evidence_items (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  source_task_id        uuid,
  source_family         text not null check (source_family in (
                          'web_search', 'monitored_page', 'publication', 'public_social',
                          'linkedin', 'manual'
                        )),
  provider_key          text not null check (btrim(provider_key) <> ''),
  source_external_id    text,
  source_url            text not null check (btrim(source_url) <> ''),
  canonical_url         text not null check (btrim(canonical_url) <> ''),
  canonical_url_hash    text not null check (canonical_url_hash ~ '^[0-9a-f]{64}$'),
  source_name           text,
  title                 text,
  excerpt               text not null check (btrim(excerpt) <> ''),
  content_hash          text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  published_at          timestamptz,
  published_date_known  boolean not null default false,
  collected_at          timestamptz not null default now(),
  submission_route      text not null check (submission_route in ('automated', 'researcher')),
  submitted_by          uuid references auth.users(id) on delete set null,
  researcher_confidence text check (researcher_confidence is null or researcher_confidence in ('strong', 'maybe', 'nothing')),
  factual_notes         text,
  capture_metadata      jsonb not null default '{}'::jsonb check (jsonb_typeof(capture_metadata) = 'object'),
  created_at            timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (source_task_id, workspace_id)
    references public.source_tasks(id, workspace_id) on delete restrict,
  check (published_date_known = (published_at is not null)),
  check (
    (submission_route = 'researcher' and submitted_by is not null)
    or submission_route = 'automated'
  )
);

create unique index evidence_provider_item_unique
  on public.evidence_items (workspace_id, source_family, provider_key, source_external_id)
  where source_external_id is not null;
create unique index evidence_url_content_unique
  on public.evidence_items (workspace_id, canonical_url_hash, content_hash)
  where source_external_id is null;
create index evidence_workspace_collected_idx
  on public.evidence_items (workspace_id, collected_at desc);
create index evidence_task_idx
  on public.evidence_items (source_task_id, workspace_id)
  where source_task_id is not null;
create index evidence_url_idx
  on public.evidence_items (workspace_id, canonical_url_hash, collected_at desc);
create index evidence_submitted_by_idx
  on public.evidence_items (submitted_by)
  where submitted_by is not null;

create or replace function private.prevent_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Evidence items are immutable';
end
$$;

revoke all on function private.prevent_evidence_mutation() from public;

create trigger prevent_evidence_update
  before update on public.evidence_items
  for each row execute function private.prevent_evidence_mutation();
create trigger prevent_evidence_delete
  before delete on public.evidence_items
  for each row execute function private.prevent_evidence_mutation();

create table public.provider_payloads (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete restrict,
  source_task_id    uuid,
  evidence_item_id  uuid,
  payload           jsonb not null,
  captured_at       timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days'),
  foreign key (source_task_id, workspace_id)
    references public.source_tasks(id, workspace_id) on delete cascade,
  foreign key (evidence_item_id, workspace_id)
    references public.evidence_items(id, workspace_id) on delete cascade,
  check (num_nonnulls(source_task_id, evidence_item_id) >= 1),
  check (expires_at > captured_at)
);

create index provider_payloads_workspace_expiry_idx
  on public.provider_payloads (workspace_id, expires_at);
create index provider_payloads_task_idx
  on public.provider_payloads (source_task_id, workspace_id)
  where source_task_id is not null;
create index provider_payloads_evidence_idx
  on public.provider_payloads (evidence_item_id, workspace_id)
  where evidence_item_id is not null;

create table public.entity_matches (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete restrict,
  evidence_item_id  uuid not null,
  agency_id         uuid not null,
  contact_id        uuid,
  match_method      text not null,
  confidence        numeric(4,3) not null check (confidence between 0 and 1),
  confidence_level  text not null check (confidence_level in ('low', 'medium', 'high')),
  reasons           jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  decision          text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (evidence_item_id, workspace_id)
    references public.evidence_items(id, workspace_id) on delete cascade,
  foreign key (agency_id, workspace_id)
    references public.agencies(id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete cascade,
  check ((decision = 'pending') = (decided_at is null))
);

create unique index entity_matches_agency_only_unique
  on public.entity_matches (evidence_item_id, agency_id)
  where contact_id is null;
create unique index entity_matches_contact_unique
  on public.entity_matches (evidence_item_id, agency_id, contact_id)
  where contact_id is not null;
create index entity_matches_workspace_decision_idx
  on public.entity_matches (workspace_id, decision, confidence desc);
create index entity_matches_evidence_idx
  on public.entity_matches (evidence_item_id, workspace_id);
create index entity_matches_agency_idx
  on public.entity_matches (agency_id, workspace_id);
create index entity_matches_contact_idx
  on public.entity_matches (contact_id, workspace_id)
  where contact_id is not null;
create index entity_matches_decided_by_idx
  on public.entity_matches (decided_by)
  where decided_by is not null;

create or replace function private.validate_entity_match_contact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contact_id is not null and not exists (
    select 1
    from public.contacts c
    where c.id = new.contact_id
      and c.workspace_id = new.workspace_id
      and c.agency_id = new.agency_id
  ) then
    raise exception 'Entity-match contact must belong to the matched agency';
  end if;
  return new;
end
$$;

revoke all on function private.validate_entity_match_contact() from public;

create trigger validate_entity_match_contact
  before insert or update of workspace_id, agency_id, contact_id
  on public.entity_matches
  for each row execute function private.validate_entity_match_contact();

create or replace function private.stamp_entity_match_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.decision is distinct from old.decision then
    if new.decision = 'pending' then
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := (select auth.uid());
      new.decided_at := now();
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.stamp_entity_match_decision() from public;

create trigger stamp_entity_match_decision
  before update of decision on public.entity_matches
  for each row execute function private.stamp_entity_match_decision();

-- ---------------------------------------------------------------------------
-- Workspace events and campaign qualification
-- ---------------------------------------------------------------------------

create table public.signals (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  agency_id                  uuid not null,
  signal_definition_id       uuid not null references public.signal_definitions(id) on delete restrict,
  event_date                 date,
  event_date_precision       text not null default 'unknown'
                             check (event_date_precision in ('day', 'month', 'unknown')),
  factual_summary            text not null check (btrim(factual_summary) <> ''),
  named_entities             jsonb not null default '[]'::jsonb check (jsonb_typeof(named_entities) = 'array'),
  event_fingerprint          text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  primary_evidence_item_id   uuid not null,
  classification_confidence numeric(4,3) not null check (classification_confidence between 0 and 1),
  status                     text not null default 'proposed'
                             check (status in ('proposed', 'verified', 'rejected', 'merged')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, event_fingerprint),
  foreign key (agency_id, workspace_id)
    references public.agencies(id, workspace_id) on delete cascade,
  foreign key (primary_evidence_item_id, workspace_id)
    references public.evidence_items(id, workspace_id) on delete restrict,
  check ((event_date_precision = 'unknown') = (event_date is null))
);

create index signals_workspace_status_date_idx
  on public.signals (workspace_id, status, event_date desc nulls last);
create index signals_agency_idx
  on public.signals (agency_id, workspace_id, event_date desc nulls last);
create index signals_definition_idx
  on public.signals (signal_definition_id);
create index signals_primary_evidence_idx
  on public.signals (primary_evidence_item_id, workspace_id);

create or replace function private.validate_signal_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.signal_definitions d
    where d.id = new.signal_definition_id
      and d.is_active
      and (d.workspace_id is null or d.workspace_id = new.workspace_id)
  ) then
    raise exception 'Signal definition is not active for this workspace';
  end if;
  return new;
end
$$;

revoke all on function private.validate_signal_definition() from public;

create trigger validate_signal_definition
  before insert or update of workspace_id, signal_definition_id
  on public.signals
  for each row execute function private.validate_signal_definition();

create trigger validate_campaign_rule_definition
  before insert or update of workspace_id, signal_definition_id
  on public.campaign_signal_rules
  for each row execute function private.validate_signal_definition();

create trigger touch_updated_at
  before update on public.signals
  for each row execute function private.touch_updated_at();

create table public.signal_sources (
  workspace_id      uuid not null references public.workspaces(id) on delete restrict,
  signal_id         uuid not null,
  evidence_item_id  uuid not null,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  primary key (signal_id, evidence_item_id),
  foreign key (signal_id, workspace_id)
    references public.signals(id, workspace_id) on delete cascade,
  foreign key (evidence_item_id, workspace_id)
    references public.evidence_items(id, workspace_id) on delete restrict
);

create unique index signal_sources_one_primary
  on public.signal_sources (signal_id)
  where is_primary;
create index signal_sources_workspace_idx
  on public.signal_sources (workspace_id);
create index signal_sources_signal_idx
  on public.signal_sources (signal_id, workspace_id);
create index signal_sources_evidence_idx
  on public.signal_sources (evidence_item_id, workspace_id);

create table public.campaign_signals (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  campaign_id                uuid not null,
  signal_id                  uuid not null,
  contact_id                 uuid not null,
  entity_match_id            uuid not null,
  event_specificity_score    smallint not null default 0 check (event_specificity_score between 0 and 2),
  evidence_strength_score    smallint not null default 0 check (evidence_strength_score between 0 and 2),
  commercial_relevance_score smallint not null default 0 check (commercial_relevance_score between 0 and 2),
  timing_score               smallint not null default 0 check (timing_score between 0 and 2),
  contact_value_score        smallint not null default 0 check (contact_value_score between 0 and 2),
  total_score                smallint generated always as (
                               event_specificity_score + evidence_strength_score +
                               commercial_relevance_score + timing_score + contact_value_score
                             ) stored,
  identity_confidence        text not null check (identity_confidence in ('low', 'medium', 'high')),
  qualification_state        text not null default 'pending'
                             check (qualification_state in ('pending', 'needs_review', 'ready', 'rejected')),
  rejection_reason           text,
  why_this_person            text,
  warnings                   jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  cooldown_until             timestamptz,
  queue_state                text not null default 'new'
                             check (queue_state in ('new', 'saved', 'dismissed', 'actioned')),
  reviewed_by                uuid references auth.users(id) on delete set null,
  reviewed_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (id, workspace_id),
  unique (campaign_id, signal_id, contact_id),
  foreign key (campaign_id, workspace_id)
    references public.campaigns(id, workspace_id) on delete cascade,
  foreign key (signal_id, workspace_id)
    references public.signals(id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete cascade,
  foreign key (entity_match_id, workspace_id)
    references public.entity_matches(id, workspace_id) on delete cascade,
  check ((qualification_state = 'rejected') = (rejection_reason is not null))
);

create index campaign_signals_queue_idx
  on public.campaign_signals (
    workspace_id, queue_state, qualification_state, total_score desc, created_at desc
  )
  where queue_state in ('new', 'saved');
create index campaign_signals_workspace_idx
  on public.campaign_signals (workspace_id);
create index campaign_signals_campaign_idx
  on public.campaign_signals (campaign_id, workspace_id, created_at desc);
create index campaign_signals_signal_idx
  on public.campaign_signals (signal_id, workspace_id);
create index campaign_signals_contact_idx
  on public.campaign_signals (contact_id, workspace_id, created_at desc);
create index campaign_signals_match_idx
  on public.campaign_signals (entity_match_id, workspace_id);
create index campaign_signals_reviewed_by_idx
  on public.campaign_signals (reviewed_by)
  where reviewed_by is not null;

create or replace function private.validate_campaign_signal_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  signal_agency_id uuid;
begin
  select s.agency_id
    into signal_agency_id
    from public.signals s
    where s.id = new.signal_id
      and s.workspace_id = new.workspace_id;

  if signal_agency_id is null then
    raise exception 'Campaign signal must reference a signal in the same workspace';
  end if;

  if not exists (
    select 1
    from public.entity_matches m
    join public.signal_sources ss
      on ss.evidence_item_id = m.evidence_item_id
     and ss.signal_id = new.signal_id
     and ss.workspace_id = new.workspace_id
    where m.id = new.entity_match_id
      and m.workspace_id = new.workspace_id
      and m.agency_id = signal_agency_id
      and m.contact_id = new.contact_id
      and m.decision = 'accepted'
  ) then
    raise exception 'Campaign signal requires an accepted match from its supporting evidence';
  end if;

  return new;
end
$$;

revoke all on function private.validate_campaign_signal_links() from public;

create trigger validate_campaign_signal_links
  before insert or update of workspace_id, signal_id, contact_id, entity_match_id
  on public.campaign_signals
  for each row execute function private.validate_campaign_signal_links();

create or replace function private.stamp_campaign_signal_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.qualification_state is distinct from old.qualification_state
     or new.rejection_reason is distinct from old.rejection_reason
     or new.queue_state is distinct from old.queue_state then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  return new;
end
$$;

revoke all on function private.stamp_campaign_signal_review() from public;

create trigger stamp_campaign_signal_review
  before update of qualification_state, rejection_reason, queue_state
  on public.campaign_signals
  for each row execute function private.stamp_campaign_signal_review();

create trigger touch_updated_at
  before update on public.campaign_signals
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

alter table public.campaigns enable row level security;
alter table public.campaign_prospects enable row level security;
alter table public.signal_definitions enable row level security;
alter table public.campaign_signal_rules enable row level security;
alter table public.campaign_source_rules enable row level security;
alter table public.search_runs enable row level security;
alter table public.source_tasks enable row level security;
alter table public.evidence_items enable row level security;
alter table public.provider_payloads enable row level security;
alter table public.entity_matches enable row level security;
alter table public.signals enable row level security;
alter table public.signal_sources enable row level security;
alter table public.campaign_signals enable row level security;

revoke all on public.campaigns, public.campaign_prospects,
  public.signal_definitions, public.campaign_signal_rules, public.campaign_source_rules,
  public.search_runs, public.source_tasks, public.evidence_items, public.provider_payloads,
  public.entity_matches, public.signals, public.signal_sources, public.campaign_signals
  from anon, authenticated;

grant select on public.campaigns, public.campaign_prospects,
  public.signal_definitions, public.campaign_signal_rules, public.campaign_source_rules,
  public.search_runs, public.source_tasks, public.evidence_items, public.provider_payloads,
  public.entity_matches, public.signals, public.signal_sources, public.campaign_signals
  to authenticated;

grant insert, update, delete on public.campaigns, public.campaign_prospects,
  public.signal_definitions, public.campaign_signal_rules, public.campaign_source_rules
  to authenticated;
grant insert on public.evidence_items to authenticated;
grant update (decision) on public.entity_matches to authenticated;
grant update (qualification_state, rejection_reason, queue_state)
  on public.campaign_signals to authenticated;

-- Member read policies.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'campaigns', 'campaign_prospects', 'campaign_signal_rules', 'campaign_source_rules',
    'search_runs', 'source_tasks', 'evidence_items', 'entity_matches', 'signals',
    'signal_sources', 'campaign_signals'
  ]
  loop
    execute format($policy$
      create policy "workspace members read" on public.%I
      for select to authenticated
      using (workspace_id in (select private.my_workspace_ids()))
    $policy$, table_name);
  end loop;
end
$$;

create policy "members read signal definitions"
  on public.signal_definitions
  for select to authenticated
  using (
    workspace_id is null
    or workspace_id in (select private.my_workspace_ids())
  );

create policy "owners read provider payloads"
  on public.provider_payloads
  for select to authenticated
  using ((select private.has_workspace_role(
    workspace_id, array['owner', 'client_admin']::text[]
  )));

-- Owners and client administrators manage campaign configuration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'campaigns', 'campaign_prospects', 'campaign_signal_rules', 'campaign_source_rules'
  ]
  loop
    execute format($policy$
      create policy "workspace owners insert" on public.%I
      for insert to authenticated
      with check ((select private.has_workspace_role(
        workspace_id, array['owner', 'client_admin']::text[]
      )))
    $policy$, table_name);
    execute format($policy$
      create policy "workspace owners update" on public.%I
      for update to authenticated
      using ((select private.has_workspace_role(
        workspace_id, array['owner', 'client_admin']::text[]
      )))
      with check ((select private.has_workspace_role(
        workspace_id, array['owner', 'client_admin']::text[]
      )))
    $policy$, table_name);
    execute format($policy$
      create policy "workspace owners delete" on public.%I
      for delete to authenticated
      using ((select private.has_workspace_role(
        workspace_id, array['owner', 'client_admin']::text[]
      )))
    $policy$, table_name);
  end loop;
end
$$;

create policy "owners insert workspace signal definitions"
  on public.signal_definitions
  for insert to authenticated
  with check (
    workspace_id is not null
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'client_admin']::text[]
    ))
  );

create policy "owners update workspace signal definitions"
  on public.signal_definitions
  for update to authenticated
  using (
    workspace_id is not null
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'client_admin']::text[]
    ))
  )
  with check (
    workspace_id is not null
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'client_admin']::text[]
    ))
  );

create policy "owners delete workspace signal definitions"
  on public.signal_definitions
  for delete to authenticated
  using (
    workspace_id is not null
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'client_admin']::text[]
    ))
  );

create policy "members submit researcher evidence"
  on public.evidence_items
  for insert to authenticated
  with check (
    submission_route = 'researcher'
    and source_task_id is null
    and submitted_by = (select auth.uid())
    and (select private.has_workspace_role(
      workspace_id, array['owner', 'reviewer', 'researcher', 'client_admin']::text[]
    ))
  );

create policy "research team decides entity matches"
  on public.entity_matches
  for update to authenticated
  using ((select private.has_workspace_role(
    workspace_id, array['owner', 'reviewer', 'researcher', 'client_admin']::text[]
  )))
  with check ((select private.has_workspace_role(
    workspace_id, array['owner', 'reviewer', 'researcher', 'client_admin']::text[]
  )));

create policy "reviewers decide campaign signals"
  on public.campaign_signals
  for update to authenticated
  using ((select private.has_workspace_role(
    workspace_id, array['owner', 'reviewer', 'client_admin']::text[]
  )))
  with check ((select private.has_workspace_role(
    workspace_id, array['owner', 'reviewer', 'client_admin']::text[]
  )));

revoke truncate on public.campaigns, public.campaign_prospects,
  public.signal_definitions, public.campaign_signal_rules, public.campaign_source_rules,
  public.search_runs, public.source_tasks, public.evidence_items, public.provider_payloads,
  public.entity_matches, public.signals, public.signal_sources, public.campaign_signals
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Global definitions and one unscheduled draft campaign
-- ---------------------------------------------------------------------------

insert into public.signal_definitions
  (key, label, description, polarity, is_legacy)
values
  ('growth_ambition', 'Growth ambition', 'Expansion plans, public growth targets, investment or new market entry.', 'opportunity', false),
  ('team_expansion', 'Team expansion', 'Senior commercial, marketing or new-business hires and relevant vacancies.', 'intent', false),
  ('offer_development', 'Offer development', 'A new service, product, capability, partnership or sector focus.', 'intent', false),
  ('positioning_change', 'Positioning change', 'A rebrand, proposition change, new website or major narrative shift.', 'intent', false),
  ('system_pressure', 'System pressure', 'Public signs of fragmented process, resource strain or delivery pressure.', 'pressure', false),
  ('pipeline_quality', 'Pipeline quality', 'Business-development hiring, pitch activity, lead concerns or inconsistent prospecting.', 'pressure', false),
  ('commercial_targets', 'Commercial targets', 'Revenue ambition, client concentration, investment expectation or growth commitment.', 'opportunity', false),
  ('ownership_change', 'Ownership change', 'Acquisition, management buyout, founder transition, merger or succession.', 'intent', false),
  ('marketing_consistency', 'Marketing consistency', 'A new content programme, research release, event series or renewed market activity.', 'intent', false),
  ('explicit_frustration', 'Explicit frustration', 'A decision-maker directly describes a relevant commercial or operational problem.', 'pressure', false),
  ('recognition', 'Recognition', 'An award, shortlist, ranking or other credible recognition.', 'opportunity', false),
  ('client_movement', 'Client movement', 'A public client win, loss, retained relationship or major case-study release.', 'opportunity', false),
  ('commercial_momentum', 'Commercial momentum', 'Legacy combined client-win and recognition category retained for comparison.', 'opportunity', true),
  ('ai_enabled_growth', 'AI-enabled growth', 'Legacy category for public engagement with practical AI adoption and workflows.', 'perspective', true),
  ('founder_perspective', 'Founder perspective', 'Legacy category for a founder or leader expressing a personal view.', 'perspective', true);

insert into public.campaigns (
  workspace_id, name, objective, status, owner_user_id,
  freshness_days, cooldown_days, weight, daily_target,
  discovery_daily_limit, daily_cost_limit_usd, schedule, timezone
)
select
  w.id,
  'UK independent agencies - founders',
  'Find credible, recent reasons to speak with leaders at independent UK agencies.',
  'draft',
  owner.user_id,
  14,
  30,
  1,
  25,
  0,
  0,
  '{}'::jsonb,
  w.timezone
from public.workspaces w
left join lateral (
  select m.user_id
  from public.workspace_members m
  where m.workspace_id = w.id
    and m.status = 'active'
    and m.role = 'owner'
  order by m.is_default desc, m.created_at
  limit 1
) owner on true
where w.slug = 'coris'
on conflict do nothing;

insert into public.campaign_signal_rules (
  workspace_id, campaign_id, signal_definition_id, enabled, minimum_score
)
select c.workspace_id, c.id, d.id, not d.is_legacy, 7
from public.campaigns c
join public.signal_definitions d on d.workspace_id is null
where c.name = 'UK independent agencies - founders'
on conflict (campaign_id, signal_definition_id) do nothing;

insert into public.campaign_source_rules (
  workspace_id, campaign_id, source_family, provider_key, enabled, scan_interval_days
)
select c.workspace_id, c.id, source.source_family, source.provider_key, source.enabled, source.scan_interval_days
from public.campaigns c
cross join (values
  ('manual'::text, 'researcher'::text, true, 1),
  ('linkedin'::text, 'apify'::text, true, 1),
  ('web_search'::text, null::text, false, 1)
) as source(source_family, provider_key, enabled, scan_interval_days)
where c.name = 'UK independent agencies - founders'
on conflict do nothing;

-- Seed one target per Focus agency. Prefer a senior contact; keep an agency-only
-- target when no linked person exists. The campaign remains draft.
insert into public.campaign_prospects (
  workspace_id, campaign_id, agency_id, contact_id, group_type, priority
)
select
  c.workspace_id,
  c.id,
  a.id,
  chosen.id,
  'watchlist',
  case when chosen.id is null then 0 else 10 end
from public.campaigns c
join public.agencies a
  on a.workspace_id = c.workspace_id
 and a.tier = 'focus'
left join lateral (
  select person.id
  from public.contacts person
  where person.workspace_id = a.workspace_id
    and person.agency_id = a.id
    and coalesce(person.status, '') <> 'Archived'
  order by
    case
      when coalesce(person.title, '') ~* '\m(founder|owner|chief executive|ceo|managing director|md)\M' then 0
      else 1
    end,
    person.created_at,
    person.id
  limit 1
) chosen on true
where c.name = 'UK independent agencies - founders'
on conflict do nothing;
