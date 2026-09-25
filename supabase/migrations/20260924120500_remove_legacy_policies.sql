-- ============================================================================
-- STEP 1 · STAGE 4 · Remove the legacy access policies
-- Applied 25 Sep 2026 after the Stage 3 dashboard smoke test passed.
-- After this, access to prospect data depends only on
-- workspace membership. Enquiries (public guide inbox) keep their own policies.
-- ============================================================================
drop policy if exists "owner all contacts"                     on public.contacts;
drop policy if exists "owner all templates"                    on public.email_templates;
drop policy if exists "Users manage own signal runs"           on public.prospect_signal_runs;
drop policy if exists "Users manage own prospect signals"      on public.prospect_signals;
drop policy if exists "Users manage own prospect discoveries"  on public.prospect_discoveries;
drop policy if exists "Users manage own signal copy templates" on public.signal_copy_templates;
