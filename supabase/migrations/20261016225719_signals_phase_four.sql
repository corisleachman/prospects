begin;
alter table public.campaigns add column watch_revision integer not null default 0;
alter table public.campaigns add column watch_refresh_enabled boolean not null default false;
alter table public.campaigns add column next_watch_refresh_at timestamptz;
alter table public.campaigns add column watch_exclusions jsonb not null default '[]' check(jsonb_typeof(watch_exclusions)='array');
alter table public.companies add column discovery_key text unique;
alter table public.people add column discovery_key text unique;
alter table public.people add constraint people_id_company_unique unique(id,company_id);
alter table public.campaign_prospects alter column agency_id drop not null;
alter table public.campaign_prospects add column company_id uuid references public.companies(id);
alter table public.campaign_prospects add column person_id uuid;
alter table public.campaign_prospects add column source text;
alter table public.campaign_prospects add column brand_of uuid references public.companies(id);
alter table public.campaign_prospects add column last_refreshed_at timestamptz;
alter table public.campaign_prospects add column match_score numeric check(match_score between 0 and 10);
alter table public.campaign_prospects add constraint campaign_prospects_entity_shape check((agency_id is not null and company_id is null and person_id is null) or (agency_id is null and contact_id is null and company_id is not null));
alter table public.campaign_prospects add constraint campaign_prospects_person_company_fk foreign key(person_id,company_id) references public.people(id,company_id);
create unique index campaign_prospects_company_only on public.campaign_prospects(campaign_id,company_id) where company_id is not null and person_id is null;
create unique index campaign_prospects_person on public.campaign_prospects(campaign_id,person_id) where person_id is not null;
create index campaign_prospects_company_idx on public.campaign_prospects(company_id);
create index campaign_prospects_person_idx on public.campaign_prospects(person_id,company_id);
create index campaign_prospects_brand_idx on public.campaign_prospects(brand_of);
create table public.discovery_previews (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),profile_id uuid not null,
 run_id uuid,reservation_id uuid,kind text not null default 'find' check(kind in ('find','refresh')),
 status text not null default 'quoted' check(status in ('quoted','queued','running','succeeded','partial','failed')),
 profile_revision integer not null,plan jsonb not null,result jsonb not null default '{"companies":[],"people":[],"warnings":[]}',
 estimated_gbp numeric(14,6) not null check(estimated_gbp>0),actual_gbp numeric(14,6) not null default 0,
 error_summary text,step integer not null default 0,lease_until timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),saved_at timestamptz,
 foreign key(profile_id,workspace_id) references public.campaigns(id,workspace_id),foreign key(run_id,workspace_id) references public.search_runs(id,workspace_id),foreign key(reservation_id,workspace_id) references public.cost_reservations(id,workspace_id),unique(id,workspace_id)
);
create index discovery_previews_workspace_idx on public.discovery_previews(workspace_id);
create index discovery_previews_profile_idx on public.discovery_previews(profile_id,created_at desc);
create index discovery_previews_run_idx on public.discovery_previews(run_id);
create index discovery_previews_reservation_idx on public.discovery_previews(reservation_id);
create index discovery_previews_creator_idx on public.discovery_previews(created_by);
create table public.discovery_refresh_log (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),profile_id uuid not null,
 status text not null,reason text,created_at timestamptz not null default now(),foreign key(profile_id,workspace_id) references public.campaigns(id,workspace_id)
);
create index discovery_refresh_workspace_idx on public.discovery_refresh_log(workspace_id);
create index discovery_refresh_profile_idx on public.discovery_refresh_log(profile_id,created_at desc);
do $$declare t text;begin foreach t in array array['discovery_previews','discovery_refresh_log'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform reads discovery" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);
 end loop;end $$;

create function private.start_signals_discovery(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;r uuid;run uuid;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.discovery_previews where id=p_id) for update;
 select * into p from public.discovery_previews where id=p_id for update;
 if p.id is null or p.status<>'quoted' or p.created_at<now()-interval '30 minutes' then raise exception 'Quote unavailable or expired. Estimate again.';end if;
 if not exists(select 1 from public.campaigns where id=p.profile_id and workspace_id=p.workspace_id and setup_revision=p.profile_revision and status<>'archived') then raise exception 'Profile changed. Estimate again.';end if;
 r:=private.reserve_signals_cost(p.workspace_id,'discovery:'||p.id::text,p.estimated_gbp,false);
 insert into public.search_runs(workspace_id,campaign_id,run_type,idempotency_key,status,input_scope,requested_by,started_at)
 values(p.workspace_id,p.profile_id,case when p.kind='refresh' then 'scheduled' else 'find_more' end,'discovery:'||p.id::text,'running',jsonb_build_object('kind',p.kind),p.created_by,now()) returning id into run;
 update public.discovery_previews set reservation_id=r,run_id=run,status='queued' where id=p.id;return p.id;end;$$;

-- An approved quote holds the full cap. Each call atomically takes its own
-- reservation from that escrow, without reserving the same money twice.
create function private.claim_signals_discovery_step(p_id uuid,p_cap numeric) returns jsonb language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;hold public.cost_reservations;r uuid;remain numeric;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.discovery_previews where id=p_id) for update;
 select * into p from public.discovery_previews where id=p_id for update;
 if p.id is null or p.status<>'queued' then return null;end if;
 if not exists(select 1 from public.workspaces where id=p.workspace_id and status not in ('paused','archived')) then raise exception 'Client paused';end if;
 perform 1 from public.client_budgets where id=(select budget_id from public.cost_reservations where id=p.reservation_id) for update;
 select * into hold from public.cost_reservations where id=p.reservation_id for update;
 if hold.status<>'reserved' or p_cap<=0 or p_cap>hold.estimated_cost or p_cap is null then raise exception 'Quote cap exhausted';end if;
 remain:=hold.estimated_cost-p_cap;
 if remain=0 then update public.cost_reservations set status='cancelled' where id=hold.id;
 else update public.cost_reservations set estimated_cost=remain where id=hold.id;end if;
 insert into public.cost_reservations(workspace_id,budget_id,request_key,estimated_cost) values(p.workspace_id,hold.budget_id,'discovery:'||p.id::text||':'||p.step,p_cap) returning id into r;
 insert into public.source_tasks(workspace_id,run_id,task_key,source_family,provider_key,input,status,started_at,estimated_cost_usd) values(p.workspace_id,p.run_id,'discovery-step:'||p.step,'web_search','treg',jsonb_build_object('stage','find','preview_id',p.id,'step',p.step),'running',now(),p_cap/(p.plan->>'fx')::numeric);
 update public.discovery_previews set status='running',lease_until=now()+interval '5 minutes' where id=p.id;
 return jsonb_build_object('preview',to_jsonb(p),'reservation',r,'request_key','discovery:'||p.id::text||':'||p.step);end;$$;

create function private.finish_signals_discovery_step(p_id uuid,p_reservation uuid,p_cost numeric,p_details jsonb,p_result jsonb,p_plan jsonb,p_done boolean,p_error text) returns void language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;lid uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.discovery_previews where id=p_id) for update;
 select * into p from public.discovery_previews where id=p_id for update;
 if p.status<>'running' or not exists(select 1 from public.cost_reservations where id=p_reservation and workspace_id=p.workspace_id and request_key='discovery:'||p.id::text||':'||p.step) then raise exception 'Step unavailable';end if;
 update public.source_tasks set status=case when p_error is null then 'succeeded' else 'failed' end,completed_at=now(),actual_cost_usd=coalesce((p_details->'units'->>'provider_cost_usd')::numeric,0),error_summary=p_error,provider_key=coalesce(p_details->>'source_key','treg') where run_id=p.run_id and task_key='discovery-step:'||p.step;
 lid:=private.settle_signals_cost(p_reservation,p_cost,p_details||jsonb_build_object('profile_id',p.profile_id,'run_id',p.run_id));
 update public.discovery_previews set result=p_result,plan=p_plan,step=step+1,actual_gbp=actual_gbp+p_cost,lease_until=null,
 status=case when p_error is not null then case when jsonb_array_length(p_result->'companies')>0 then 'partial' else 'failed' end when p_done then 'succeeded' else 'queued' end,error_summary=p_error where id=p.id;
 if p_done or p_error is not null then
 perform private.cancel_signals_cost(p.reservation_id);
 update public.search_runs set status=case when p_error is not null then 'partial' else 'succeeded' end,completed_at=now(),error_summary=p_error,actual_cost_usd=(select coalesce(sum(actual_cost_usd),0) from public.source_tasks where run_id=p.run_id),new_count=jsonb_array_length(p_result->'companies')+jsonb_array_length(p_result->'people') where id=p.run_id;
 if p.kind='refresh' then update public.campaigns set next_watch_refresh_at=now()+case when p_error is null then interval '7 days' else interval '1 day' end where id=p.profile_id;end if;
 end if;end;$$;

create function private.save_signals_watchlist(p_id uuid,p_company_keys jsonb,p_person_keys jsonb) returns integer language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;c jsonb;person jsonb;cid uuid;pid uuid;company_ids jsonb:='{}';n integer:=0;limit_n integer;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.discovery_previews where id=p_id) for update;
 select * into p from public.discovery_previews where id=p_id for update;
 if p.id is null or p.status not in ('succeeded','partial') then raise exception 'Completed preview required';end if;
 select watch_list_size into limit_n from public.campaigns where id=p.profile_id and workspace_id=p.workspace_id and setup_revision=p.profile_revision;
 if not found then raise exception 'Profile changed. Find matches again.';end if;
 if not exists(select 1 from public.campaigns where id=p.profile_id and watch_revision=coalesce((p.plan->>'saved_watch_revision')::integer,(p.plan->'profile'->>'watch_revision')::integer,0)) then raise exception 'Watch list changed. Find matches again.';end if;
 if p.kind='refresh' and not exists(select 1 from public.campaigns where id=p.profile_id and watch_refresh_enabled) then raise exception 'Weekly refresh is disabled';end if;
 if jsonb_typeof(p_company_keys)<>'array' or jsonb_typeof(p_person_keys)<>'array' or p_company_keys is null or p_person_keys is null then raise exception 'Choose companies and people';end if;
 if jsonb_array_length(p_company_keys)>limit_n then raise exception 'Watch-list size exceeded';end if;
 if exists(select 1 from jsonb_array_elements_text(p_company_keys) k where not exists(select 1 from jsonb_array_elements(p.result->'companies') x where x->>'key'=k)) or exists(select 1 from jsonb_array_elements_text(p_person_keys) k where not exists(select 1 from jsonb_array_elements(p.result->'people') x where x->>'key'=k)) then raise exception 'Selection outside this preview';end if;
 -- Only V2 rows for this exact profile are replaced. CRM watch lists stay intact.
 delete from public.campaign_prospects where campaign_id=p.profile_id and workspace_id=p.workspace_id and company_id is not null;
 for c in select value from jsonb_array_elements(p.result->'companies') where p_company_keys ? (value->>'key') loop
 select id into cid from public.companies where discovery_key=c->>'key' or (nullif(c->>'domain','') is not null and lower(domain)=lower(c->>'domain')) limit 1;
 if cid is not null then update public.companies set name=c->>'name',website=coalesce(nullif(c->>'website',''),website),linkedin_url=coalesce(nullif(c->>'linkedin_url',''),linkedin_url),discovery_key=coalesce(discovery_key,c->>'key'),updated_at=now() where id=cid;
 else
 insert into public.companies(workspace_id,name,website,domain,linkedin_url,industry,location,provider_ids,discovery_key)
 values(p.workspace_id,c->>'name',nullif(c->>'website',''),nullif(c->>'domain',''),nullif(c->>'linkedin_url',''),c->>'industry',c->>'location',coalesce(c->'provider_ids','{}'),c->>'key')
 on conflict(discovery_key) do update set name=excluded.name,website=coalesce(excluded.website,public.companies.website),linkedin_url=coalesce(excluded.linkedin_url,public.companies.linkedin_url),updated_at=now() returning id into cid;
 end if;
 company_ids:=company_ids||jsonb_build_object(c->>'key',cid);
 insert into public.campaign_prospects(workspace_id,campaign_id,company_id,source,group_type,last_refreshed_at) values(p.workspace_id,p.profile_id,cid,coalesce(c->>'source','discovered'),'watchlist',now());n:=n+1;
 end loop;
 for person in select value from jsonb_array_elements(p.result->'people') where p_person_keys ? (value->>'key') loop
 cid:=(company_ids->>(person->>'company_key'))::uuid;
 if cid is null then raise exception 'Select the person’s company too';end if;
 insert into public.people(workspace_id,name,title,company_id,linkedin_url,location,provider_ids,last_checked_at,discovery_key)
 values(p.workspace_id,person->>'name',person->>'title',cid,person->>'linkedin_url',person->>'location',coalesce(person->'provider_ids','{}'),now(),person->>'key')
 on conflict(discovery_key) do update set name=excluded.name,title=excluded.title,company_id=excluded.company_id,last_checked_at=now() returning id into pid;
 insert into public.campaign_prospects(workspace_id,campaign_id,company_id,person_id,source,group_type,last_refreshed_at) values(p.workspace_id,p.profile_id,cid,pid,'discovered','watchlist',now());
 end loop;
 if p.kind='find' then update public.campaigns set watch_exclusions=(select coalesce(jsonb_agg(x->>'key'),'[]') from jsonb_array_elements((p.result->'companies')||(p.result->'people')) x where not(p_company_keys ? (x->>'key')) and not(p_person_keys ? (x->>'key'))) where id=p.profile_id;end if;
 update public.campaigns set watch_revision=watch_revision+1 where id=p.profile_id;
 update public.discovery_previews set saved_at=now(),plan=plan||jsonb_build_object('saved_watch_revision',(select watch_revision from public.campaigns where id=p.profile_id)) where id=p.id;
 update public.campaigns set next_watch_refresh_at=case when watch_refresh_enabled then now()+interval '7 days' else null end where id=p.profile_id;
 return n;end;$$;
create function private.set_signals_refresh(p_profile uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501';end if;
 update public.campaigns set watch_refresh_enabled=coalesce(p_enabled,false),next_watch_refresh_at=case when p_enabled then now()+interval '7 days' else null end
 where id=p_profile and exists(select 1 from public.workspaces where id=workspace_id and is_signals_client);
 if not found then raise exception 'Profile unavailable';end if;end;$$;
create function public.start_signals_discovery(p_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.start_signals_discovery(p_id);$$;
create function public.claim_signals_discovery_step(p_id uuid,p_cap numeric) returns jsonb language sql security invoker set search_path='' as $$select private.claim_signals_discovery_step(p_id,p_cap);$$;
create function public.finish_signals_discovery_step(p_id uuid,p_reservation uuid,p_cost numeric,p_details jsonb,p_result jsonb,p_plan jsonb,p_done boolean,p_error text) returns void language sql security invoker set search_path='' as $$select private.finish_signals_discovery_step(p_id,p_reservation,p_cost,p_details,p_result,p_plan,p_done,p_error);$$;
create function public.save_signals_watchlist(p_id uuid,p_company_keys jsonb,p_person_keys jsonb) returns integer language sql security invoker set search_path='' as $$select private.save_signals_watchlist(p_id,p_company_keys,p_person_keys);$$;
create function public.set_signals_refresh(p_profile uuid,p_enabled boolean) returns void language sql security invoker set search_path='' as $$select private.set_signals_refresh(p_profile,p_enabled);$$;
do $$declare fn text;begin foreach fn in array array['start_signals_discovery(uuid)','save_signals_watchlist(uuid,jsonb,jsonb)','set_signals_refresh(uuid,boolean)'] loop
 execute 'revoke all on function private.'||fn||' from public,anon';execute 'revoke all on function public.'||fn||' from public,anon';
 execute 'grant execute on function private.'||fn||' to authenticated,service_role';execute 'grant execute on function public.'||fn||' to authenticated,service_role';end loop;
 foreach fn in array array['claim_signals_discovery_step(uuid,numeric)','finish_signals_discovery_step(uuid,uuid,numeric,jsonb,jsonb,jsonb,boolean,text)'] loop
 execute 'revoke all on function private.'||fn||' from public,anon,authenticated';execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function private.'||fn||' to service_role';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;

create function private.recover_signals_discovery() returns void language plpgsql security definer set search_path='' as $$
 declare p public.discovery_previews;r public.cost_reservations;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 for p in select * from public.discovery_previews where status='running' and lease_until<now() loop
 select * into r from public.cost_reservations where workspace_id=p.workspace_id and request_key='discovery:'||p.id::text||':'||p.step;
 begin perform private.finish_signals_discovery_step(p.id,r.id,r.estimated_cost,jsonb_build_object('stage','find','provider','treg','source_key','worker-timeout','cost_basis','estimated','outcome','failed','units',jsonb_build_object('receipt_missing',true,'provider_cost_usd',r.estimated_cost/(p.plan->>'fx')::numeric)),p.result,p.plan,true,'Worker stopped before recording its receipt. Reserved cap recorded conservatively; call will not be repeated.');
 exception when others then null;end;
 end loop;end;$$;
create function public.recover_signals_discovery() returns void language sql security invoker set search_path='' as $$select private.recover_signals_discovery();$$;
revoke all on function private.recover_signals_discovery(),public.recover_signals_discovery() from public,anon,authenticated;
grant execute on function private.recover_signals_discovery(),public.recover_signals_discovery() to service_role;
commit;
