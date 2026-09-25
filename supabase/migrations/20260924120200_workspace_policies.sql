-- ============================================================================
-- STEP 1 · 3/5 · Workspace-membership RLS, added ALONGSIDE existing policies
-- Permissive policies combine with OR, so the owner keeps access through the
-- old email / user_id policies while these are verified. The old policies are
-- removed in a later migration once the two-workspace isolation test passes
-- (see docs/step-1/RUNBOOK.md, stage 4).
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['contacts','email_templates','prospect_signal_runs',
                           'prospect_signals','prospect_discoveries','signal_copy_templates']
  loop
    execute format('drop policy if exists "workspace members all" on public.%I', t);
    execute format($p$create policy "workspace members all" on public.%I
                      for all to authenticated
                      using (workspace_id in (select private.my_workspace_ids()))
                      with check (workspace_id in (select private.my_workspace_ids()))$p$, t);
  end loop;
end $$;
