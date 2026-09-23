# Working on this repo (humans and AI agents)

**Product:** Prospects dashboard, a focused UK agency prospect database (agencies + key people), an insights engine that says who to speak to and when, and the existing follow-up/reminder system. Static GitHub Pages front end + Supabase.

## Rules
1. **This repo is the source of truth.** Every database change is a migration in `supabase/migrations/`. Every edge function lives in `supabase/functions/`. Never change the live project from the dashboard or SQL editor without committing the equivalent file.
2. **No secrets in git.** Use `Deno.env.get()` in functions and Supabase Vault in SQL. The anon key in `index.html` is public by design; nothing else is.
3. **Branch + PR for anything non-trivial.** Several agents commit here. Keep `main` deployable, since GitHub Pages serves it directly.
4. **Protect working features.** The Research queue, Ready for Coris, Agencies, email compose, Signals modal and Chrome-extension path (`save-prospect`) must keep working. Their fields on `contacts` are not to be renamed or repurposed.
5. **Every product table carries `workspace_id`** and has RLS based on `private.my_workspace_ids()`. New tables need explicit grants.
6. **Agencies are records.** `contacts.agency_id` links a person to an agency. The `b10_link_agency` trigger keeps it current from `contacts.company`.
7. **Outreach stays human.** Nothing sends LinkedIn messages automatically.

## Context
- The researcher currently signs in with the owner's account, so `verified_by` always shows the owner's email.
- Plans: `docs/roadmap.md`. Audit: `docs/signals-v1/audit.md`. Step runbooks: `docs/step-*/`.
