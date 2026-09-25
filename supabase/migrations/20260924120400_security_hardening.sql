-- ============================================================================
-- STEP 1 · 5/5 · Security hardening (no behaviour change for the app)
-- ============================================================================

-- 1. Move the enquiry webhook secret out of the function body into Vault.
--    The current value is read from the live function at apply time, so the
--    secret never appears in this repository and notify-enquiry keeps working.
do $$
declare
  existing text;
begin
  select substring(pg_get_functiondef('public.notify_enquiry_fn()'::regprocedure)
                   from '''x-webhook-secret''\s*,\s*''([^'']+)''')
    into existing;
  if existing is not null and existing <> '__REDACTED__'
     and not exists (select 1 from vault.secrets where name = 'notify_enquiry_webhook_secret') then
    perform vault.create_secret(existing, 'notify_enquiry_webhook_secret');
  end if;
end $$;

create or replace function public.notify_enquiry_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform net.http_post(
    url := 'https://paprxejgeepvtbqmfgvt.supabase.co/functions/v1/notify-enquiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce((select s.decrypted_secret from vault.decrypted_secrets s
                                     where s.name = 'notify_enquiry_webhook_secret'), '')),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end; $function$;

-- 2. SECURITY DEFINER functions must not be callable through /rest/v1/rpc.
--    (Triggers and event triggers still fire: EXECUTE is checked when a
--    trigger is created, not each time it runs.)
revoke execute on function public.notify_enquiry_fn() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()   from public, anon, authenticated;

-- 3. Least privilege for the anonymous role. RLS already blocks it, but
--    grants should say the same thing. The public guide only needs INSERT
--    on enquiries (it posts with Prefer: return=minimal).
revoke all on public.contacts, public.email_templates, public.enquiries from anon;
grant insert on public.enquiries to anon;

-- 4. TRUNCATE bypasses RLS; nobody using the API needs it.
revoke truncate on public.contacts, public.email_templates, public.enquiries,
  public.prospect_signal_runs, public.prospect_signals, public.prospect_discoveries,
  public.signal_copy_templates, public.agencies
  from anon, authenticated;
