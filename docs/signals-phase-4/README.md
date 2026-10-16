# Phase 4: find matches and watch lists

Each profile now has a Find matches screen. Estimating is free; approving the displayed cap starts the paid search. Results show company websites, LinkedIn links and current employment links returned by the provider. Unticking a company also unticks its people. Saving replaces only that profile's V2 watch list. The legacy CRM stays separate.

The initial preview defaults to 25 companies, adjustable to the profile limit (maximum 200). Counts describe provider candidates, not verified ICP fit. Free-text company descriptions become editable keyword hints. Titles, industry, country, headcount and USD revenue filters use native provider fields. Unsupported country input, non-USD revenue constraints and parent/sub-brand expansion fail before payment. Related companies can be added explicitly; ownership links are never inferred.

## Provider choice and pricing

[treg](https://treg.to) routes company discovery to `blitzapi.companies.search`: structured industry, country, employee and revenue filters, cursor pagination and $0.000495 per returned company at implementation. `harvestapi.linkedin.leads.search` supplies current-company and job-title searches, up to 25 people per page, at $0.10 per call. Company-name-only search was unsuitable for ICP discovery; more expensive enrichment endpoints weren't necessary here. Compact catalog snapshots are included beside this document.

Quotes fetch live catalog prices and [ECB reference rates](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml). Rates older than seven days and changed billing types fail closed. A quote expires after 30 minutes. The full conservative GBP cap is reserved once; each provider call atomically splits off its share. No automatic retries of paid calls. Every receipt, including a failed call's charge, reaches the cost ledger. Missing receipts settle at the call cap and are labelled estimated. Explicit zero receipts remain zero.

The worker needs the existing Supabase `TREG_TOKEN`. It never exposes the token to the app. Authentication verifies the user with Supabase Auth and the active platform-admin record, or verifies a separate private cron token. Public function JWT verification is replaced by these explicit checks. The mail transport settings are copied from the existing server environment into Vault only when an administrator approves a run; they are used for existing budget threshold alerts.

## Refresh

Weekly refresh is off by default. Opting in checks people only at approved companies; it doesn't discover new companies. Manually excluded people stay excluded. Profile and watch-list revisions prevent an older search overwriting a newer selection. The ten-minute worker resumes approved jobs, recovers abandoned calls conservatively, drains configured budget alerts and handles due opt-in refreshes. Missing/spent/test budgets or paused clients block paid work. No profile is enrolled by a migration.

## Verification

Node tests cover provider filters, link normalisation, receipt accounting, expired/stale quotes, escrow, selection boundaries, role isolation and abandoned calls. Browser tests cover approval, progress across unchanged polls, deselection, save, links and mobile overflow. Deno checks the deployed worker; Next builds the app. The core migration and scheduler were checked against Prospects in transactions that rolled back, with synthetic rows and no provider calls or email.

The current BEFORE:WORK budget is a spent £10 test budget. It is preserved. Real discovery acceptance still needs an explicitly funded normal budget and a paid run for each profile. Phase 5 remains separate.

## Rollout, 17 October 2026

Both committed migrations are applied. Edge worker version 3 is active; app deployment `dpl_46qMfv4UMMFLyX9xgeQ3oDdi1a88` is READY. The authenticated browser generated a free quote for each real BEFORE:WORK profile: 25 companies and 25 people, maximum £0.159258 each, FX date 16 October. Both correctly block payment on the spent test budget. No paid discovery ledger rows were created and no refresh is enabled.

Live checks caught and fixed an ambiguous company join and the ECB XML's single-quoted attributes. The fixture now rejects ambiguous joins; an adapter test checks both XML quote styles and stale rates. Final local validation: 35 Node tests, 13 browser tests (the discovery test repeated after the join fix), Deno check and Next production build pass. Security advisors retain only the project's existing pg_net extension warning.

Draft PR: https://github.com/corisleachman/prospects/pull/35, stacked on Phase 3. Paid results and cost reconciliation still await an approved normal budget. Parent/sub-brand expansion remains unsupported by this adapter and fails explicitly before payment.
