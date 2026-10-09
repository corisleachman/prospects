# Step 3: campaign and evidence foundation

Status: stage 3a drafted and verified on an ephemeral Supabase branch on 9 October 2026. Production application is not approved.

## Outcome

Step 3 should create the smallest safe foundation for Prospect Signals V1 without replacing the working dashboard.

The first usable result is simple: a researcher can submit a source, or the existing LinkedIn scan can collect one, and both routes produce the same evidence record. That evidence can then be matched to an agency and contact, grouped into one event, and qualified for a campaign.

The daily review board, message generation and scheduled collection come later. Building them before the evidence model is proven would make weak assumptions expensive to unwind.

## Decisions made in this plan

- Keep one application and one Supabase project. Workspaces provide client isolation.
- Keep `agencies` as the company record. Do not introduce a competing `companies` table.
- Keep `contacts` as the person record and preserve every existing researcher field.
- Treat captured evidence as a workspace record. It doesn't belong to one campaign.
- Treat a signal as one deduplicated real-world event. It also doesn't belong to one campaign.
- Put contact choice, score, review state and outreach suitability on `campaign_signals`.
- Preserve `prospect_signal_runs`, `prospect_signals` and the current Signals modal during the transition.
- Keep the LinkedIn conversation-discovery feed separate. It uses a different scoring model and remains outside Prospect Signals V1.
- Pilot with one campaign in the interface, but make the schema support several campaigns from day one.
- Require an explicit `workspace_id` in every new server-side collection path. The legacy default-workspace fallback is not used by new functions.

## Current base to preserve

The live Supabase project and `origin/main` agree on 29 migrations and six Edge Functions. This working branch adds one candidate migration, bringing its local total to 30.

Already available:

- `workspaces` and `workspace_members`, with membership-based RLS.
- `agencies`, agency notes, tiers and contact links.
- Agency-aware CSV import and undo.
- The Research queue and Ready for Coris workflow.
- The current Apify LinkedIn post scan and its review modal.
- Existing outreach, email and follow-up fields on `contacts`.

The existing `prospect_signals` table mixes source evidence, classification, score and review state. It remains readable while the new path is introduced, but it shouldn't become the base for the wider product.

## Record boundaries

```text
campaign -> campaign prospect
         -> campaign signal -> contact, score, review state, message drafts
                            |
workspace -> signal --------+
          -> signal sources -> evidence item -> source task -> search run
                           -> entity matches -> agency/contact candidates
```

This split matters when the same event is relevant to two campaigns. The article is stored once. The event is stored once. Each campaign can select a different person, apply a different relevance score, or decide not to surface it.

## Proposed records

### Existing records kept as-is

| Record | Use in Step 3 |
| --- | --- |
| `workspaces` | Tenant and operating boundary |
| `workspace_members` | Membership and role source for RLS |
| `agencies` | Company identity and ICP details |
| `contacts` | Person identity, relationship state and existing research workflow |
| `agency_notes` | Human-readable agency intelligence log, not raw evidence storage |
| `prospect_signal_runs` | Legacy LinkedIn quick-scan run log |
| `prospect_signals` | Legacy LinkedIn results during dual-running |
| `prospect_discoveries` | Separate conversation-discovery feed |
| `signal_copy_templates` | Legacy copy guidance until voice profiles replace it |

No existing column is renamed or repurposed.

### New campaign records

#### `campaigns`

Purpose: the configuration unit for an audience, source rules, signal rules and operating limits.

Important fields:

- `id`, `workspace_id`, `name`, `objective`, `status`
- `owner_user_id`
- `freshness_days`, `cooldown_days`, `weight`
- `daily_target`, `discovery_daily_limit`, `daily_cost_limit_usd`
- `schedule`, `timezone`
- `created_at`, `updated_at`, `archived_at`

Status values: `draft`, `active`, `paused`, `archived`.

The first record is a draft Coris pilot campaign. It isn't scheduled by the migration.

#### `campaign_prospects`

Purpose: explicit membership, rotation state and suppression for a campaign.

Important fields:

- `campaign_id`, `workspace_id`, `agency_id`
- `contact_id`, nullable for an agency that doesn't yet have a selected person
- `group_type`: `watchlist`, `rotating`, `suppressed`
- `priority`, `suppression_reason`
- `last_scanned_at`, `next_eligible_at`
- `added_by`, `created_at`, `updated_at`

Use partial unique indexes so an agency-only target and a contact target can't be duplicated accidentally.

#### `signal_definitions`

Purpose: reusable observable event definitions.

Global definitions have `workspace_id = null` and are read-only to application users. Workspace-specific definitions have a workspace ID and can be managed by owners.

Important fields include `key`, `label`, `description`, positive examples, false-positive guidance and active state.

The taxonomy is seeded only after the live categories and the specification categories are reconciled. Legacy category values remain on legacy rows.

#### `campaign_signal_rules`

Purpose: enable a definition for one campaign and describe how it should be judged.

Important fields include `campaign_id`, `signal_definition_id`, `enabled`, `minimum_score`, `strategy`, `cta_rule` and `requires_owner_approval`.

#### `campaign_source_rules`

Purpose: allow or reject source families, domains and profiles for a campaign.

Important fields include `campaign_id`, `source_family`, `provider_key`, inclusion rules, exclusions, scan interval and active state.

Core tables store `provider_key`, not provider-specific columns. Provider details stay in task input and adapter output.

### New collection records

#### `search_runs`

Purpose: one retry-safe campaign run.

Important fields:

- `workspace_id`, `campaign_id`, optional `parent_run_id`
- `run_type`: `scheduled`, `find_more`, `manual`, `legacy_scan`
- `idempotency_key`, unique within the workspace
- `status`: `queued`, `running`, `partial`, `succeeded`, `failed`, `cancelled`
- input scope, counts, estimated cost and actual cost
- `requested_by`, `started_at`, `completed_at`, `error_summary`

An all-campaign run creates a parent record and one child run per campaign. Costs and retries then remain attributable.

#### `source_tasks`

Purpose: one independently retryable provider or manual-intake job.

Important fields include `run_id`, `workspace_id`, `source_family`, `provider_key`, `input`, `provider_reference`, `status`, `attempt_count`, cost, timestamps and a safe error summary.

Task idempotency is unique within a run. A failed task cannot delete evidence written by successful tasks.

#### `evidence_items`

Purpose: an immutable captured source observation.

Important fields:

- `workspace_id`, optional `source_task_id`
- `source_family`, `provider_key`, `source_external_id`
- original URL, canonical URL and canonical URL hash
- title, source name, excerpt and content hash
- publication date, whether that date is known, and collection time
- submission route: `automated` or `researcher`
- `submitted_by`, researcher confidence and factual notes
- capture metadata needed to explain the item

URL uniqueness must not be global. A monitored page can change while keeping the same URL.

Deduplication rules:

- If the provider supplies a stable item ID, enforce uniqueness on workspace, provider and that ID.
- Otherwise enforce uniqueness on workspace, canonical URL hash and content hash.
- Store a new snapshot when the URL is unchanged but the meaningful content hash changes.
- Store large provider payloads separately with an expiry date.

Evidence rows aren't edited after capture. A correction is a review decision or a new evidence version.

#### `provider_payloads`

Purpose: short-lived raw provider output for diagnosis and audit.

It links to a source task or evidence item and carries `expires_at`. Normal application users don't need direct access.

#### `entity_matches`

Purpose: record possible and accepted agency/contact matches without overwriting the source.

Important fields include `evidence_item_id`, `agency_id`, optional `contact_id`, method, confidence, reasons, decision, deciding user and timestamp.

Confidence and decision are separate. A high model confidence is still only a proposal until the matching rules or a human accept it.

### New event and qualification records

#### `signals`

Purpose: one deduplicated event in the workspace.

Important fields:

- `workspace_id`, `agency_id`
- `signal_definition_id`, event date and date precision
- factual summary and named entities
- event fingerprint, unique within the workspace
- primary evidence item
- classification confidence and status
- `created_at`, `updated_at`

This table has no campaign ID, contact-specific score, review state or draft message.

#### `signal_sources`

Purpose: connect an event to every supporting evidence item and identify the primary source.

One event may have a company announcement, a trade article and a LinkedIn post. They should produce one reviewable event, not three cards.

#### `campaign_signals`

Purpose: decide whether one event is useful for one campaign and contact.

Important fields:

- `workspace_id`, `campaign_id`, `signal_id`, `contact_id`
- accepted `entity_match_id`
- event specificity, evidence strength, commercial relevance, timing and contact value scores
- generated total score from the five factors
- identity confidence, qualification state and rejection reason
- `why_this_person`, warnings and cooldown status
- queue state, reviewer and review timestamps

Unique key: campaign, signal and contact.

Suggested qualification states: `pending`, `needs_review`, `ready`, `rejected`.

Suggested queue states: `new`, `saved`, `dismissed`, `actioned`.

Keeping these states separate stops a scoring decision from being confused with a user's review action.

### Later records that use the foundation

`voice_profiles`, `voice_examples`, `message_drafts`, `review_actions` and `outreach_events` are part of V1, but they don't need to block the first evidence slice.

Their boundaries are fixed now:

- Message drafts belong to `campaign_signals` and are versioned.
- Review actions are append-only and carry the acting user.
- Outreach events record the final human action. No record sends a LinkedIn message.
- Approved edits can become voice examples only after owner approval.

## One intake path

Automated and researcher evidence must enter through the same normalization contract.

The intake contract accepts:

- explicit workspace and optional campaign/run context
- source family and provider key
- original URL, provider item ID and source date
- title, excerpt and the minimum raw metadata needed for matching
- submission route and submitting user when relevant

It returns an existing or new evidence ID, dedupe result and processing status.

Researcher submission uses the signed-in user's RLS context. Automated collection uses a server credential, but must send a workspace ID resolved from the authenticated run or validated callback. It must never fall back to the legacy default workspace.

## Current LinkedIn scan transition

The Apify scan stays working throughout Step 3.

1. Keep the current estimate and paid-run confirmation unchanged.
2. Keep writing `prospect_signal_runs` and `prospect_signals` so the existing modal still works.
3. Add an explicit adapter that maps each accepted Apify item into the shared evidence contract.
4. Link the legacy run to its new `search_runs` record for audit.
5. Compare old and new qualification results during the pilot.
6. Switch the review board only after counts and matching have been checked.

This is deliberate dual-writing, not a permanent second pipeline. Removal of legacy writes needs a separate approval after the new review flow is live.

## Provider-neutral collection

Every automated collector implements the same small interface:

```text
estimate(request) -> estimated items and cost
start(request) -> provider reference
poll(provider reference) -> status and usage
normalise(provider item) -> evidence intake record
```

Provider names may appear in adapter configuration and task records. They don't appear as required columns on campaigns, evidence or signals.

The primary web-search provider remains open. Compare providers against the same 50-prospect set and score evidence coverage, date quality, canonical URLs, false matches, latency and cost. Don't choose on result count alone.

## Security and RLS

Every new public table has RLS enabled and explicit grants. `anon` receives no access.

Read policy:

```text
workspace_id in (select private.my_workspace_ids())
```

Write access is narrower:

- Owners manage campaigns, rules and workspace definitions.
- Reviewers update campaign-signal decisions and later message drafts.
- Researchers can submit manual evidence and make permitted match decisions.
- Collection tasks, raw payloads and automated qualification are server-written.

Add a private role helper only if table policies need it. If added, it must use a fixed empty search path, check active membership, be callable only by the required roles, and remain outside the exposed schema.

Updates need a matching SELECT policy plus both `USING` and `WITH CHECK`. Any view exposed to the browser uses `security_invoker = true` on the current Postgres version.

Service-role functions receive an explicit workspace ID and validate it against the run or task they are processing. Provider callbacks are untrusted until their signature or provider reference is checked.

## Build stages

### 3a. Schema foundation

Create the campaign, run, evidence, match, signal and campaign-signal records. Add RLS, grants, constraints and isolation tests. Seed one draft campaign and the agreed signal definitions.

No current function or screen writes to these tables yet.

Checkpoint: replay migrations in an isolated database or Supabase development branch, then run two-workspace read and write tests.

### 3b. Researcher evidence slice

Add a small Submit evidence form to the existing Research queue. It writes through the common intake path, then shows the stored URL, source date and processing state.

Keep all current research fields and status actions.

Checkpoint: a researcher submission becomes evidence, receives an agency/contact match proposal and can be reviewed without touching production outreach state.

### 3c. LinkedIn compatibility slice

Add the provider adapter and dual-write to `prospect-signal-scan`. Keep the existing modal and legacy tables intact.

Checkpoint: the same Apify item doesn't create duplicate evidence on retry, and a failure after evidence capture leaves the run recoverable rather than stuck on `running`.

### 3d. First web collector

Use the fixed 50-prospect comparison set. Implement the chosen provider behind the adapter only after results are reviewed.

Checkpoint: evidence from LinkedIn, web search and manual submission has the same stored shape and can support one event fingerprint.

### 3e. Qualification pilot

Run matching, event grouping and the five-factor score without generating messages. Show the proposed queue in a private comparison view.

Checkpoint: review at least 50 proposed candidates and record wrong-company, wrong-person, duplicate, stale and weak-event rates.

## Acceptance criteria for stage 3a

- Existing dashboard counts and working flows remain unchanged.
- The current Signals modal still reads its legacy tables.
- One draft campaign resolves a valid set of eligible contacts and agency-only targets.
- Evidence can represent a stable article, a LinkedIn post and two snapshots of one monitored page.
- Two sources about one event can link to one signal.
- One signal can produce separate campaign qualifications without duplicating evidence.
- Every new workspace record is isolated in both directions between two test users.
- Researchers can't manage campaign configuration or automated task records.
- Every new table has RLS, explicit grants, indexed policy columns and tested update policies.
- Migration history remains identical between the repository and the target environment after application.
- Security advisors show no new warnings.
- No provider or model secret reaches browser code, logs or committed files.
- No LinkedIn message is sent automatically.

## Not part of stage 3a

- Scheduled collection or enabling `pg_cron`
- A campaign-builder interface
- Message generation
- Today's signals board
- Find more signals
- Selecting the web-search provider
- Migrating or deleting legacy signal rows
- Client activation

## Approved defaults for stage 3a

1. Use the `signals` and `campaign_signals` split.
2. Pilot one campaign in the interface while retaining multi-campaign schema support.
3. Seed the 12 specification categories plus the three legacy-only categories. Legacy rules start disabled.
4. Use the specification's five-factor score. Existing legacy scores remain untouched for comparison.
5. Retain raw provider payloads for 30 days by default.
6. Use an ephemeral Supabase development branch for migration replay and isolation tests, subject to its hourly cost being confirmed first.

The stage 3a migration and repeatable isolation test are now drafted. They must pass on an isolated database before production application is considered.
