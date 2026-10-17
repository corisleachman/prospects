select set_config('request.jwt.claim.sub',(select user_id::text from public.platform_admins where active limit 1),true);
set local role authenticated;
do $$declare w uuid;p uuid;p2 uuid;code1 text;begin
w:=public.create_signals_client('UI catch-up rollback','Europe/London');
p:=public.create_signals_profile(w);p2:=public.create_signals_profile(w);
select code into code1 from public.campaigns where id=p;
if code1<>'01' then raise exception 'Default code missing';end if;
perform public.save_signals_profile(w,p,0,'{"name":"Growth brands","code":"01B","criteria":{"industries":["Consumer Goods"],"locations":["United States"],"revenue_range":{"min":5000000,"max":100000000,"currency":"USD"}}}');
if (select code from public.campaigns where id=p)<>'01B' then raise exception 'Code save failed';end if;
begin perform public.save_signals_profile(w,p2,0,'{"name":"Other profile","code":"01B"}');raise exception 'Duplicate accepted';exception when unique_violation then null;end;
perform public.save_signals_client(w,0,'{"name":"UI catch-up rollback","timezone":"Europe/London","profile_limit":5,"website":"https://example.test","client_type":"Ad agency"}');
if (select website from public.workspaces where id=w)<>'https://example.test' then raise exception 'Website save failed';end if;
if public.signals_admin_month_spend() is null then raise exception 'Monthly spend missing';end if;
end $$;
reset role;
select 'passed: code defaults, uniqueness, save revisions, client metadata and monthly spend' as result;
rollback;
