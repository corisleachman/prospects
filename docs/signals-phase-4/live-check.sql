select set_config('request.jwt.claim.sub',(select user_id::text from public.platform_admins where active limit 1),true);
set local role authenticated;
create temporary table phase_four_check as select public.create_signals_client('Phase 4 rollback check','Europe/London') as workspace_id;
alter table phase_four_check add column profile_id uuid;
update phase_four_check set profile_id=public.create_signals_profile(workspace_id);
select public.change_signals_budget(workspace_id,'create',10,current_date,current_date+30,'Rollback check',false) from phase_four_check;
reset role;
grant select on phase_four_check to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare w uuid;p uuid;q uuid;r uuid;n numeric;begin
 select workspace_id,profile_id into w,p from phase_four_check;
 insert into public.discovery_previews(workspace_id,profile_id,profile_revision,plan,estimated_gbp)
 values(w,p,0,'{"fx":1,"profile":{"watch_revision":0}}',1) returning id into q;
 perform public.start_signals_discovery(q);
 r:=(public.claim_signals_discovery_step(q,.2)->>'reservation')::uuid;
 select sum(estimated_cost) into n from public.cost_reservations where workspace_id=w and status='reserved';
 if n<>1 then raise exception 'Escrow counted twice';end if;
 if public.claim_signals_discovery_step(q,.2) is not null then raise exception 'Duplicate worker claimed';end if;
 perform public.finish_signals_discovery_step(q,r,.1,'{"stage":"find","provider":"fixture","cost_basis":"reported","outcome":"success"}',
 '{"companies":[{"key":"domain:rollback.test","name":"Rollback","domain":"rollback.test","website":"https://rollback.test","source":"discovered"}],"people":[],"warnings":[]}',
 '{"fx":1,"profile":{"watch_revision":0}}',true,null);
 if exists(select 1 from public.cost_reservations where workspace_id=w and status='reserved') then raise exception 'Unused hold not released';end if;
 if (select sum(cost) from public.cost_ledger where workspace_id=w)<>.1 then raise exception 'Cost not recorded';end if;
 perform public.save_signals_watchlist(q,'["domain:rollback.test"]','[]');
 if (select count(*) from public.campaign_prospects where campaign_id=p and company_id is not null)<>1 then raise exception 'Watch list not saved';end if;
end $$;
reset role;
select 'passed: escrow, duplicate claim, exact charge, unused release and approved watch list' as result;
rollback;
