-- ============================================================================
-- PRE-HISTORY BASELINE (reconstructed 23 Sep 2026, not a record of what ran)
-- ----------------------------------------------------------------------------
-- The contacts, email_templates and enquiries tables, their owner policies,
-- the enquiry notification trigger and the RLS event trigger were created in
-- the Supabase dashboard before migration tracking began (first tracked
-- migration: 20260823162945). This file recreates that starting state so the
-- folder replays from zero to the live schema.
--
-- Status on the live project: ALREADY APPLIED. Register it in history without
-- running it (see docs/step-1/RUNBOOK.md).
--
-- Notes
-- * The original anon policies on contacts ("anon can read contacts",
--   "anon can insert contacts") are not recreated: their definitions are not
--   recoverable and 20260824081859 drops them with IF EXISTS.
-- * The live notify_enquiry_fn held a webhook secret literal. It is redacted
--   here and moved to Supabase Vault by 20260923100400_security_hardening.sql.
-- * The ensure_rls event trigger needs superuser; on a fresh Supabase project
--   the platform may already provide it.
-- ============================================================================

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  email text,
  company text,
  title text,
  category text,
  source text,
  status text default 'Not contacted',
  replied boolean default false,
  bounced boolean default false,
  linkedin_url text,
  notes text,
  last_emailed_at timestamptz,
  follow_up_at date,
  website text
);
create index if not exists contacts_category_idx on public.contacts (category);
create index if not exists contacts_followup_idx on public.contacts (follow_up_at);
create index if not exists contacts_replied_idx on public.contacts (replied);
alter table public.contacts enable row level security;
create policy "owner all contacts" on public.contacts for all to authenticated
  using ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com')
  with check ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com');

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  subject text,
  body text,
  sort_order integer default 0
);
alter table public.email_templates enable row level security;
create policy "owner all templates" on public.email_templates for all to authenticated
  using ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com')
  with check ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com');

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text,
  email text,
  company text,
  message text,
  source text default 'guide'
);
alter table public.enquiries enable row level security;
create policy "anon insert enquiries" on public.enquiries for insert to anon with check (true);
create policy "owner read enquiries" on public.enquiries for select to authenticated
  using ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com');

create or replace function public.notify_enquiry_fn()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  perform net.http_post(
    url := 'https://paprxejgeepvtbqmfgvt.supabase.co/functions/v1/notify-enquiry',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret','__REDACTED__'),
    body := jsonb_build_object('record', to_jsonb(NEW))
  );
  return NEW;
end; $function$;
create trigger notify_enquiry_trg after insert on public.enquiries
  for each row execute function public.notify_enquiry_fn();

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
  end if;
end $$;
