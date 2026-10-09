# Step 3a runbook

Status: local migration verified on an ephemeral development branch. Nothing has been applied to production.

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

Do not merge the Supabase branch into production. Production application is a separate approval after review and a fresh backup check.

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

For this verification, the repository's reconstructed baseline was applied only to the disposable branch before the remaining migrations were pushed. Production wasn't changed. Fixing branch portability needs its own reviewed migration-history procedure before preview branches can be treated as one-command replicas.

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

## Rollback before production

Delete the ephemeral Supabase branch. The production project remains untouched.

## Production gate

Before production application:

- The development-branch checks pass without manual exceptions.
- Security advisors report no new warnings.
- Performance advisors report no new missing indexes or RLS initialization-plan warnings.
- The current dashboard smoke test is prepared.
- The migration and its seed counts have been reviewed.
- Production application has explicit approval.
