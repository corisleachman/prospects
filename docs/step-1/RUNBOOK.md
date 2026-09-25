# Step 1 — Foundation: runbook

**What Step 1 does:** puts the database history and server code in this repo, adds workspaces, makes agencies real records linked to every contact, closes the security gaps found in the audit, and stops Research-queue edits failing silently.

**What it does not change:** how the dashboard looks or behaves, the Research queue, Ready for Coris, email, the Signals modal, the Chrome extension or any edge function.

Owner key: **C** = Coris · **AI** = Claude (via the Supabase connector, only after Coris says go) · **CC** = Coris or Claude Code on your machine.

| Stage | Who | Action | Done when |
|---|---|---|---|
| 0 | C | Review this branch (`foundation/step-1`). | You're happy with the plan. |
| 1 | C + AI | Merged (PR #10). Edge functions: Coris adds the `SUPABASE_ACCESS_TOKEN` repository secret once; Claude runs the **Pull edge functions from Supabase** Action, which opens a PR. | Six functions in the repo, no secret literals. |
| 2 | AI | Register `20260715000000` and `20260920000000` as already applied (history rows only, nothing run). Apply `20260923100000` → `20260923100400` in order, recording each under its repo version. Run `docs/step-1/checks.sql` and report. | Checks 1, 2 and 5 clean; review lists 3 and 4 sent to you. |
| 3 | C | 10-minute smoke test (below). | Everything still works. |
| 4 | AI | Move `supabase/pending/20260923100500_remove_legacy_policies.sql` into `supabase/migrations/`, apply it, re-run checks. | Access depends only on workspace membership. |
| — | C | Supabase dashboard → Authentication → enable leaked-password protection. | Advisor warning gone. |

The front-end change (`index.html`, Research queue save errors) is safe to go live at any point.

## Stage 3 smoke test
1. Sign in. Every sidebar stage and list shows the same counts as before.
2. Add a contact, edit it, archive it, undo.
3. Research queue: verify one prospect, add a note, send to Ready for Coris.
4. Ready for Coris: mark processed with a check-in date.
5. Agencies: open one, edit its website.
6. Save one LinkedIn profile with the Chrome extension.
7. Signals: open the modal and load the review queue (no paid run needed).
8. Submit a test enquiry on the build guide page and confirm the notification arrives.

## Rollback
Stages 2 and 4 are additive or reversible without data loss:
- Stage 4: recreate the six dropped policies (definitions in `20260715000000` and `20260908*`).
- Stage 2: the new columns, tables and triggers can be dropped. No existing column is changed or removed. The only rewritten object is `notify_enquiry_fn`, whose secret now lives in Vault as `notify_enquiry_webhook_secret`.
