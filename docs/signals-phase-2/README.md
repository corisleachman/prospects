# Phase 2: client details and ICP profiles

Phase 2 adds a setup link to each client in Clients. The setup page saves client name, HTTPS logo URL, timezone and a clearly labelled placeholder plan, plus draft ICP profiles. Only platform administrators can open setup or call its write functions.

Profiles support the brief's optional criteria: industries, locations, revenue and headcount ranges, company types, named companies with parent/sub-brand options, job titles, who, relevant moment, conversation to open, watch-list size and the missing-person choice. New profiles have a temporary editable name and can be saved without any criteria. Named companies remain profile configuration; no discovery or watch list is run.

Client details and profiles autosave after a brief pause. A local recovery copy is written on every edit and restored after a tab closes. Unsaved and failed states are visible. Version checks reject stale writes from another tab; the administrator can discard a stale local copy and reload. Local recovery copies belong to the signed-in administrator and this browser, and are cleared after successful saves. They do not replace database storage.

Placeholder plans are Starter (2 profiles), Growth (5) and Scale (10). New clients default to Growth so Before: Work's five profiles fit. A workspace row lock and campaign trigger enforce the cap through RPCs and direct inserts. Downgrades below existing usage are rejected. These are temporary plan limits, without payment, price or Stripe configuration.

The team section lists accepted members' email, name and role. Names can be saved; invitations reuse Phase 1's explicit email action and role selection. Role elevation is not exposed. New shared companies and people tables are empty and platform-managed. Their required workspace_id records provenance, while canonical company domains are unique across clients. Clients cannot read shared entities directly. Later delivery work must introduce precise access through cards. No CRM table is renamed or repurposed.

## Verification

21 Node tests pass, including the real migrations in embedded PostgreSQL. They exercise partial profile persistence, stale and wrong-workspace writes, direct-insert caps, plan changes, entity access and preserved V1 permissions. Browser checks use a production Next build and a local Supabase contract fixture, with no external email or collection calls. They check reload/tab-close persistence, named companies, invalid ranges, simultaneous tabs, mobile layout and client-role denial.

The complete migration and [live-check.sql](live-check.sql) passed against Prospects in one transaction that rolled back. That checked real schema compatibility, optional fields, revisions, caps, plan downgrade prevention and non-admin isolation. No test client remained.

## Coris's checks

- Open a client from Clients, enter its details and five profiles, leaving some fields blank.
- Close a tab mid-edit, reopen that profile and confirm the edit survived.
- On Growth, try adding a sixth profile and confirm the limit message appears. Switching to Scale allows more.
- Confirm client users and client admins still see Today, with no setup access.

Stop for acceptance here. Phase 3, Find matches, paid calls, watch lists and collection are not implemented.

## Rollout, 16 October 2026

The committed Phase 2 migration was applied to Prospects after the rollback check. Post-application checks confirmed RLS on companies/people, the profile-limit trigger and the existing BEFORE:WORK client's five-profile allowance. Both entity tables remain empty. Security advisors reported only the pre-existing [pg_net extension warning](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

Production deployment `dpl_FdMhxH48KY8e65E8C1ULdEkCY5GY` is READY at https://prospect-signals.vercel.app, from code commit `5fc78ba`. The authenticated browser showed BEFORE:WORK's setup page, its saved timezone and Growth placeholder plan, zero profiles and zero accepted members. No client configuration or invitation was changed during that check. GitHub CI passed in 1m13s, including all 21 Node tests and all 10 browser tests.

Draft PR: https://github.com/corisleachman/prospects/pull/33. It is stacked on Phase 1's branch. Phase 3 is not started.
