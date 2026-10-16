-- Append to the migration without its COMMIT, then run as one rollback check.
select set_config('request.jwt.claim.sub',(select user_id::text from public.platform_admins where active limit 1),true);
set local role authenticated;
create temporary table phase_three_check as select public.create_signals_client('Phase 3 rollback check','Europe/London') as workspace_id;
do $$declare w uuid;b uuid;r uuid;n integer;begin
 select workspace_id into w from phase_three_check;
 b:=public.change_signals_budget(w,'create',10,current_date,current_date+30,'Rollback test',true);
 begin perform public.reserve_signals_cost(w,'paid-on-test',1,false);raise exception 'Test budget allowed a provider';exception when raise_exception then if sqlerrm not like 'Test budgets only%' then raise;end if;end;
 perform public.add_signals_test_cost(w,8,'test-80');
 if (select count(*) from public.budget_alerts where budget_id=b and threshold=80)<>1 then raise exception '80 alert missing';end if;
 perform public.add_signals_test_cost(w,2,'test-100');
 if (select status from public.workspaces where id=w)<>'paused' then raise exception 'Client not paused';end if;
 if (select status from public.client_budgets where id=b)<>'spent' then raise exception 'Budget not spent';end if;
 if (select count(*) from public.budget_alerts where budget_id=b)<>2 then raise exception 'Threshold dedup failed';end if;
 perform public.change_signals_budget(w,'top_up',5,null,null,'Rollback top-up',false);
 if (select status from public.workspaces where id=w)<>'setup' then raise exception 'Resume failed';end if;
 perform public.change_signals_budget(w,'renew',10,current_date,current_date+30,'Rollback real gate',false);
 r:=public.reserve_signals_cost(w,'watched',8,false);
 begin perform public.reserve_signals_cost(w,'excess',3,false);raise exception 'Hard cap ignored';exception when raise_exception then if sqlerrm not like 'Hard cap:%' then raise;end if;end;
 perform public.cancel_signals_cost(r);
 begin perform public.reserve_signals_cost(w,'optional',1,true);raise exception 'Soft cap ignored';exception when raise_exception then if sqlerrm not like 'Daily soft cap:%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$begin
 if exists(select 1 from public.cost_ledger) or exists(select 1 from public.client_budgets) then raise exception 'Budget records exposed';end if;
 begin perform public.change_signals_budget((select workspace_id from phase_three_check),'create',10,current_date,current_date+30,'',true);raise exception 'Non-admin budget write';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'passed: fake-only test budgets, alerts, hard stop, top-up, reservations, soft cap and isolation' as result;
rollback;
