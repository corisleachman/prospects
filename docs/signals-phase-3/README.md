# Phase 3: budgets and cost ledger

A platform administrator can create, top up, change and renew a monthly GBP budget from each client's Budget and costs screen. The Clients list shows its total, available balance and budget pause reason. Changes are recorded with the verified administrator's email, time and note. A renewal closes the old budget without removing its ledger or history.

Test budgets are separate from normal budgets. The explicit Add fake cost button writes labelled test entries without calling a provider. Normal provider reservations reject test budgets. Fake costs cannot be added to a normal budget. No actual budget was created for BEFORE:WORK by this build.

## Call boundary for later phases

Every future provider caller must reserve a conservative estimated GBP amount with `reserve_signals_cost` before making the external call. Workspace and budget row locks serialize reservations. The hard cap includes outstanding reservations, so concurrent callers cannot reserve the same remaining balance. Duplicate request keys are rejected before a new call. Pending reservations block renewal.

Optional work uses `p_optional=true` and is stopped at the daily soft cap: remaining budget divided by the days remaining in the client's timezone. Watched-person checks use false and can continue within the hard cap. Missing, expired, future or spent budgets and paused clients block reservations. No adapter, collection schedule or paid call is connected in Phase 3.

Settle every incurred charge with `settle_signals_cost`, including failures, using the provider's returned units and charge where available. A settlement records stage, profile/run references, provider/source/model, units, reported versus estimated cost and batch/cache flags. Repeated settlements return the existing row. Actual charges above their estimate are recorded in full and pause further calls; a reservation is a guard, not a guarantee against a provider exceeding its estimate. Cancel a reservation only when no charge was incurred. Abandoned reservations remain held until explicitly resolved rather than silently expiring and allowing overspend.

Cost and budget-history rows reject update and delete, including privileged accidental changes. Client roles cannot read or mutate budgets, pricing, alerts or the ledger. Shared-project V1 collection and its existing costs are untouched; these guards apply to new Signals callers only.

Provider pricing is kept in per-client settings, with GBP numeric rates. `tokenCostGBP` uses configured input, output, cache-read and cache-write rates plus a configured batch multiplier. Missing rates fail closed. Future adapters must obtain verified rates and currency conversion where needed; no rates or exchange rates have been invented or seeded.

## Pausing and alerts

Actual spending at the budget total marks it spent and pauses the workspace with a dated reason. Topping up or renewing restores its saved prior status and reason only when the pause was caused by this budget. Today remains accessible. The future rewrite and collection code must use the same reservation gate.

Thresholds enqueue one alert at 80% and one at 100% per budget. The recipient list comes from active, verified platform administrators, not a browser-supplied address. Budget actions deliver through Resend and record failures visibly. Retry unsent alerts uses the same provider idempotency key. Future workers must drain the same outbox after settling costs; its read/mark RPCs allow the service role. No automatic worker is introduced here.

## Verification and acceptance

Database tests cover reservations, insufficient funds, the soft cap, hard pauses, top-up, renewals, immutable rows, labelled fake costs, duplicate settlement, overrun accounting, paid failures and role isolation. Mail transport tests mock Resend and check recipients, escaping, test labels and idempotency. Browser checks run a production build against a local contract fixture, exercising create/top-up/change, fake costs, paused Clients status, history, mobile overflow and client-role denial. Earlier phase checks still run.

The full migration and [live-check.sql](live-check.sql) passed against Prospects inside a transaction that rolled back. No test budget, cost or alert remained, and no email was sent.

Coris's checks:

- Create a £10 test budget and see it on Clients and Budget.
- Top up and change the amount; confirm the history shows your email and note.
- Add £8, then £2 in fake costs. Confirm the 80% and 100% alerts arrive and Clients says “Paused: budget used up”. If delivery fails, the alert status and retry action remain visible.
- Top up or renew and confirm the prior client state returns.

Stop for acceptance before Phase 4. Real alert delivery remains to be tested through Coris's explicit fake-cost action.

## Rollout, 16 October 2026

The committed migration was applied to Prospects after the rollback check. Post-application verification confirmed RLS on all six budget tables, both append-only triggers, no anonymous reservation execution and zero actual budgets, costs or alerts. Security advisors still report only the existing [pg_net extension warning](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

Deployment `dpl_8uYw8FZDM7Z6keN4e7B65ZFYhyyZ`, code commit `50d7765`, is READY at https://prospect-signals.vercel.app. The authenticated browser showed BEFORE:WORK's empty budget screen with the £10 test default and its saved timezone's current date. No form was submitted and no live email was sent. All 27 Node and 12 browser tests pass in GitHub CI.

Draft PR: https://github.com/corisleachman/prospects/pull/34, stacked on Phase 2. Phase 4 is not started. Real alert delivery remains Coris's acceptance check.
