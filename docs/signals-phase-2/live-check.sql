-- Append after the migration body in one transaction and ROLLBACK. No email.
select set_config('request.jwt.claim.sub',(select user_id::text from public.platform_admins where active limit 1),true);
set local role authenticated;
create temporary table phase_two_check as select public.create_signals_client('Phase 2 rollback check','Europe/London') as workspace_id;
do $$ declare w uuid; p uuid; n integer; begin
 select workspace_id into w from phase_two_check;
 p:=public.create_signals_profile(w);
 perform public.save_signals_profile(w,p,0,'{"name":"Partial profile","criteria":{"industries":["Food"]}}'::jsonb);
 if not exists(select 1 from public.campaigns where id=p and setup_revision=1 and watch_list_size=200 and who='') then raise exception 'Partial profile not retained'; end if;
 begin perform public.save_signals_profile(w,p,0,'{"name":"Stale"}');raise exception 'Stale write accepted';exception when serialization_failure then null;end;
 for n in 1..4 loop perform public.create_signals_profile(w);end loop;
 begin perform public.create_signals_profile(w);raise exception 'Over-limit profile accepted';exception when raise_exception then if sqlerrm not like 'Profile limit reached%' then raise;end if;end;
 begin perform public.save_signals_client(w,0,'{"name":"Too small","timezone":"Europe/London","profile_limit":2}');raise exception 'Downgrade accepted';exception when raise_exception then if sqlerrm not like 'This plan has fewer%' then raise;end if;end;
 perform public.save_signals_client(w,0,'{"name":"Expanded","timezone":"Europe/London","profile_limit":10}');
 perform public.create_signals_profile(w);
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
 if exists(select 1 from public.companies) or exists(select 1 from public.people) then raise exception 'Entities exposed';end if;
 begin perform public.create_signals_profile((select workspace_id from phase_two_check));raise exception 'Non-admin allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'passed: optional criteria, revisions, caps, downgrade prevention, entity isolation' as result;
rollback;
