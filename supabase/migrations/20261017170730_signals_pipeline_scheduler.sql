begin;
-- Advances explicitly requested tests and live clients only. Setup clients never start scheduled paid work.
select cron.schedule('signals-pipeline-worker','*/5 * * * *',$job$
 select net.http_post(url:='https://paprxejgeepvtbqmfgvt.supabase.co/functions/v1/signals-pipeline',
 headers:=jsonb_build_object('Content-Type','application/json','X-Signals-Cron-Token',(select decrypted_secret from vault.decrypted_secrets where name='signals_discovery_cron_token')),
 body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=10000);
$job$);
commit;
