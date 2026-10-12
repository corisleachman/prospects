# Step 3a runbook

Status: migration applied to production and verified on 12 October 2026.

## What stage 3a changes

- Adds campaign configuration records.
- Adds retryable run and source-task records.
- Adds immutable evidence, entity matching and deduplicated event records.
- Adds campaign-specific scoring and review state.
- Seeds 15 signal definitions and one unscheduled draft campaign.
- Seeds one watchlist target for each current Focus agency.

## What it doesn't change

- The current Signals modal and its legacy tables.
- The Apify Edge Function.
- Research queue fields or actions.
- Email, follow-ups, agency editing or import.
- Message generation, scheduling or outreach.

## Files

- Migration: `supabase/migrations/20261009112146_step_3a_campaign_evidence_foundation.sql`
- Transactional checks: `docs/step-3/checks.sql`
- Technical plan: `docs/step-3/PLAN.md`

## Safe verification sequence

1. Review the migration and checks in the branch.
2. Create an ephemeral Supabase development branch after its hourly cost is confirmed.
3. Run the migration against the development branch inside a transaction while iterating.
4. Run `docs/step-3/checks.sql`. It creates two synthetic users and workspaces, exercises RLS, then rolls back.
5. Run Supabase security and performance advisors.
6. Fix the migration locally if any check fails. Reset the development branch before the final application.
7. Apply the final migration once so migration history is clean.
8. Re-run the checks and advisors.
9. Delete the development branch when verification is complete.

Do not merge a Supabase preview branch into production. Apply the reviewed repository migration so production history keeps the repository timestamp.

## Verification record

Verified on 9 October 2026 using a fresh ephemeral Supabase branch with no production data.

- All 30 repository migrations applied successfully after reconstructing the pre-history baseline.
- The transactional two-user, two-workspace checks passed and rolled back their synthetic records.
- All 13 foundation tables exist, with 15 global definitions and one unscheduled draft campaign.
- The security advisor returned no findings.
- The performance advisor returned no new missing foreign-key indexes, RLS initialization warnings or overlapping permissive policies from stage 3a.
- The final test branch was deleted after verification.

The remaining performance notices are older schema debt: two unindexed foreign keys and no primary key on `agency_tidy_dismissals`, an RLS initialization warning on `enquiries`, and the Auth connection allocation setting. Unused-index notices on a new empty branch aren't evidence that an index is unnecessary.

## Known branch replay issue

The production migration history contains a short registration placeholder for `20260715000000_prehistory_baseline`, because the original tables existed before migration tracking. Supabase preview branches replay that placeholder, mark the version applied, and don't create `contacts`, `email_templates` or `enquiries`. Later migrations then fail or remain unapplied.

For branch verification, the repository's reconstructed baseline was applied only to the disposable branch before the remaining migrations were pushed. Fixing branch portability needs its own reviewed migration-history procedure before preview branches can be treated as one-command replicas.

## Expected checks

- All 13 new tables exist and have RLS enabled.
- `anon` has no privileges on the new tables.
- An owner can manage campaign configuration only in their workspace.
- A researcher can submit manual evidence but can't manage campaigns or campaign review decisions.
- Provider payloads are visible only to owners and client administrators.
- Automated tables remain server-written.
- Duplicate provider items are refused.
- One monitored URL can have several content snapshots.
- Evidence updates and deletes are refused.
- One event can have several sources.
- Campaign scoring is separate from the workspace event.

## Production verification record

Applied on 12 October 2026 using `supabase db push`, preserving migration version `20261009112146`.

- A completed physical backup from 12 October 2026 at 04:10 UTC was confirmed before application. PITR was not enabled.
- The production migration history now contains all 30 repository migrations.
- The existing totals remained 1,213 agencies and 1,430 contacts.
- Production contains all 13 foundation tables, 15 global signal definitions, one draft pilot campaign and four pilot prospects.
- The transactional workspace-isolation checks passed and left no synthetic users behind.
- Security and performance advisors reported no new stage 3a findings.
- The live dashboard reached its normal sign-in gate without browser warnings or errors.

The advisor baseline still includes the existing `pg_net` public-schema warning, the `agency_tidy_dismissals` key and index notices, the `enquiries` RLS initialization warning and the Auth connection allocation notice.
