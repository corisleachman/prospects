-- ============================================================================
-- STEP 1 · 2/5 · workspace_id on every product table
-- Backfills existing rows into the Coris workspace, then a BEFORE INSERT
-- trigger fills workspace_id for any writer that doesn't send one. Nothing
-- in the current app or edge functions needs to change.
-- enquiries (public guide inbox) is deliberately left out.
-- ============================================================================

create or replace function private.set_workspace_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is null then
    new.workspace_id := private.current_workspace_id();
  end if;
  if new.workspace_id is null then
    raise exception 'No workspace available for new % row', tg_table_name;
  end if;
  return new;
end $$;

do $$
declare
  t text;
  ws uuid := (select id from public.workspaces where is_legacy_default);
begin
  if ws is null then raise exception 'Legacy default workspace missing – run 20260924120000 first'; end if;
  foreach t in array array['contacts','email_templates','prospect_signal_runs',
                           'prospect_signals','prospect_discoveries','signal_copy_templates']
  loop
    execute format('alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict', t);
    execute format('update public.%I set workspace_id = %L where workspace_id is null', t, ws);
    execute format('alter table public.%I alter column workspace_id set not null', t);
    execute format('create index if not exists %I on public.%I (workspace_id)', t || '_workspace_idx', t);
    -- "a00_" so it fires before any other BEFORE INSERT trigger (alphabetical order)
    execute format('drop trigger if exists a00_set_workspace_id on public.%I', t);
    execute format('create trigger a00_set_workspace_id before insert on public.%I for each row execute function private.set_workspace_id()', t);
  end loop;
end $$;
