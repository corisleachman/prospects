begin;
-- No client is enrolled by this migration. The worker resumes explicitly
-- approved jobs and refreshes only profiles whose switch was enabled.
create extension if not exists pg_cron with schema pg_catalog;
do $$begin
 if not exists(select 1 from vault.secrets where name='signals_discovery_cron_token') then
 perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'signals_discovery_cron_token','Internal discovery worker authentication');end if;
end $$;
create function private.verify_signals_discovery_cron(p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role','')='service_role' and length(p_token)>60 and exists(select 1 from vault.decrypted_secrets where name='signals_discovery_cron_token' and decrypted_secret=p_token);$$;
create function public.verify_signals_discovery_cron(p_token text) returns boolean language sql security invoker set search_path='' as $$select private.verify_signals_discovery_cron(p_token);$$;
create function private.signals_discovery_mail_config(p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 declare existing uuid;result jsonb;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 if p_settings is not null then
 if length(coalesce(p_settings->>'key',''))<10 or length(coalesce(p_settings->>'from',''))<3 or p_settings->>'origin'<>'https://prospect-signals.vercel.app' then raise exception 'Mail configuration unavailable';end if;
 select id into existing from vault.secrets where name='signals_discovery_mail';
 if existing is null then perform vault.create_secret(p_settings::text,'signals_discovery_mail','Budget alerts for discovery worker');else perform vault.update_secret(existing,p_settings::text);end if;
 end if;
 select decrypted_secret::jsonb into result from vault.decrypted_secrets where name='signals_discovery_mail';return result;end;$$;
create function public.signals_discovery_mail_config(p_settings jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.signals_discovery_mail_config(p_settings);$$;
revoke all on function private.verify_signals_discovery_cron(text),public.verify_signals_discovery_cron(text),private.signals_discovery_mail_config(jsonb),public.signals_discovery_mail_config(jsonb) from public,anon,authenticated;
grant execute on function private.verify_signals_discovery_cron(text),public.verify_signals_discovery_cron(text),private.signals_discovery_mail_config(jsonb),public.signals_discovery_mail_config(jsonb) to service_role;
select cron.schedule('signals-discovery-worker','*/10 * * * *',$job$
 select net.http_post(url:='https://paprxejgeepvtbqmfgvt.supabase.co/functions/v1/signals-discovery',
 headers:=jsonb_build_object('Content-Type','application/json','X-Signals-Cron-Token',(select decrypted_secret from vault.decrypted_secrets where name='signals_discovery_cron_token')),
 body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=10000);
$job$);
commit;
