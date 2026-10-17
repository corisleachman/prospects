begin;
create table public.collection_runs (
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),
 kind text not null default 'manual' check(kind in ('manual','test','scheduled')),
 snapshot jsonb not null,lease_until timestamptz,created_at timestamptz not null default now(),
 foreign key(id,workspace_id) references public.search_runs(id,workspace_id),unique(id,workspace_id)
);
create table public.collection_items (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),run_id uuid not null,source_task_id uuid not null,
 item_index integer not null,source_key text not null,item jsonb not null,canonical_url text not null default '',drop_reason text,
 evidence_id uuid,is_primary boolean not null default true,primary_item_id uuid,event_group_key text,company_ids uuid[] not null default '{}',person_id uuid references public.people(id),
 created_at timestamptz not null default now(),unique(source_task_id,item_index),unique(id,workspace_id),
 foreign key(primary_item_id,workspace_id) references public.collection_items(id,workspace_id),
 foreign key(run_id,workspace_id) references public.collection_runs(id,workspace_id),
 foreign key(source_task_id,workspace_id) references public.source_tasks(id,workspace_id),
 foreign key(evidence_id,workspace_id) references public.evidence_items(id,workspace_id)
);
create index collection_items_workspace_run on public.collection_items(workspace_id,run_id);
create index collection_items_evidence on public.collection_items(evidence_id,workspace_id);
create index collection_items_person on public.collection_items(person_id);
create index collection_items_canonical on public.collection_items(workspace_id,canonical_url) where drop_reason is null;
alter table public.source_tasks add column collection_source_key text;
alter table public.source_tasks add column collected_count integer not null default 0;
alter table public.source_tasks add column fresh_count integer not null default 0;
alter table public.source_tasks add column usable_count integer not null default 0;
alter table public.source_tasks add column drop_counts jsonb not null default '{}';
alter table public.source_tasks add column cost_gbp numeric(14,6) not null default 0;
alter table public.source_tasks add column reservation_id uuid references public.cost_reservations(id);
alter table public.source_tasks add column lease_until timestamptz;
create index source_tasks_reservation on public.source_tasks(reservation_id);
do $$declare t text;begin foreach t in array array['collection_runs','collection_items'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform reads collection" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);
 end loop;end $$;
create function private.start_signals_collection(p_workspace uuid,p_key text,p_snapshot jsonb,p_jobs jsonb,p_kind text default 'manual') returns uuid language plpgsql security definer set search_path='' as $$declare run_id uuid;j jsonb;begin
 perform private.require_signals_setup_admin(p_workspace);
 if not exists(select 1 from public.workspaces where id=p_workspace and status not in ('paused','archived')) then raise exception 'Client paused';end if;
 if not exists(select 1 from public.campaigns where workspace_id=p_workspace and status<>'archived') then raise exception 'Add an ICP profile before collecting';end if;
 if exists(select 1 from public.search_runs s join public.collection_runs c on c.id=s.id where s.workspace_id=p_workspace and s.status in ('queued','running')) then raise exception 'A collection is already in progress. Open it to continue.';end if;
 if not exists(select 1 from public.client_budgets b join public.workspaces w on w.id=b.workspace_id where b.workspace_id=p_workspace and b.status='active' and not b.is_test and (now() at time zone w.timezone)::date>=b.period_start and (now() at time zone w.timezone)::date<b.period_end) then raise exception 'Budget paused: set an active collection budget';end if;
 if p_kind not in ('manual','test') or jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs)>1000 or length(p_key) not between 1 and 160 then raise exception 'Invalid collection plan';end if;
 insert into public.search_runs(workspace_id,run_type,idempotency_key,status,input_scope,requested_by,started_at) values(p_workspace,'manual','collection:'||p_key,'queued',jsonb_build_object('kind',p_kind,'pipeline','signals_v2'),auth.uid(),now()) returning search_runs.id into run_id;
 insert into public.collection_runs(id,workspace_id,kind,snapshot) values(run_id,p_workspace,p_kind,p_snapshot);
 for j in select value from jsonb_array_elements(p_jobs) loop
 insert into public.source_tasks(workspace_id,run_id,task_key,source_family,provider_key,collection_source_key,input,estimated_cost_usd)
 values(p_workspace,run_id,j->>'key',j->>'family',j->>'provider',j->>'source_key',j,coalesce((j->>'cap_usd')::numeric,0));end loop;
 return run_id;end;$$;
create function public.start_signals_collection(p_workspace uuid,p_key text,p_snapshot jsonb,p_jobs jsonb,p_kind text default 'manual') returns uuid language sql security invoker set search_path='' as $$select private.start_signals_collection(p_workspace,p_key,p_snapshot,p_jobs,p_kind);$$;
revoke all on function private.start_signals_collection(uuid,text,jsonb,jsonb,text),public.start_signals_collection(uuid,text,jsonb,jsonb,text) from public,anon;
grant execute on function private.start_signals_collection(uuid,text,jsonb,jsonb,text),public.start_signals_collection(uuid,text,jsonb,jsonb,text) to authenticated;
create function private.claim_signals_collection_task(p_id uuid,p_fx numeric) returns jsonb language plpgsql security definer set search_path='' as $$declare t public.source_tasks;r uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.source_tasks where id=p_id) and is_signals_client for update;
 if not found then raise exception 'Client unavailable';end if;
 select * into t from public.source_tasks where id=p_id and collection_source_key is not null for update;
 if t.id is null or t.status<>'queued' then return null;end if;
 if p_fx is null or p_fx<=0 then raise exception 'Invalid exchange rate';end if;
 if exists(select 1 from public.workspaces where id=t.workspace_id and status in ('paused','archived')) then
 update public.source_tasks set status='cancelled',started_at=now(),completed_at=now(),error_code=case when (select paused_reason from public.workspaces where id=t.workspace_id) like 'budget:%' then 'budget_paused' else 'client_paused' end,error_summary=case when (select paused_reason from public.workspaces where id=t.workspace_id) like 'budget:%' then 'Budget paused' else 'Client paused or archived' end where id=t.id;return null;end if;
 if t.estimated_cost_usd>0 then
 begin r:=private.reserve_signals_cost(t.workspace_id,'collection:'||t.id::text,ceil(t.estimated_cost_usd*p_fx*1000000)/1000000,true);
 exception when others then update public.source_tasks set status='cancelled',error_code='budget_paused',error_summary='Budget paused: '||sqlerrm,completed_at=now(),started_at=now() where id=t.id;return null;end;end if;
 update public.source_tasks set status='running',attempt_count=attempt_count+1,started_at=now(),lease_until=now()+interval '5 minutes',reservation_id=r where id=t.id returning * into t;
 update public.search_runs set status='running' where id=t.run_id and status='queued';return to_jsonb(t);end;$$;
create function public.claim_signals_collection_task(p_id uuid,p_fx numeric) returns jsonb language sql security invoker set search_path='' as $$select private.claim_signals_collection_task(p_id,p_fx);$$;
create function private.finish_signals_collection_task(p_id uuid,p_cost numeric,p_usd numeric,p_basis text,p_counts jsonb,p_error text,p_reference text) returns void language plpgsql security definer set search_path='' as $$declare t public.source_tasks;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.source_tasks where id=p_id) for update;
 select * into t from public.source_tasks where id=p_id and collection_source_key is not null for update;
 if t.status<>'running' then return;end if;
 if t.reservation_id is not null then perform private.settle_signals_cost(t.reservation_id,p_cost,jsonb_build_object('stage','collect','provider',t.provider_key,'source_key',t.collection_source_key,'run_id',t.run_id,'cost_basis',p_basis,'outcome',case when p_error is null then 'success' else 'failed' end,'units',jsonb_build_object('provider_cost_usd',p_usd,'provider_reference',p_reference,'items',p_counts->'items')));end if;
 update public.source_tasks set status=case when p_error is null then 'succeeded' else 'failed' end,collected_count=coalesce((p_counts->>'items')::integer,0),fresh_count=coalesce((p_counts->>'fresh')::integer,0),drop_counts=coalesce(p_counts->'drops','{}'),actual_cost_usd=p_usd,cost_gbp=p_cost,provider_reference=coalesce(p_reference,provider_reference),error_summary=p_error,lease_until=null,completed_at=now() where id=t.id;
 end;$$;
create function public.finish_signals_collection_task(p_id uuid,p_cost numeric,p_usd numeric,p_basis text,p_counts jsonb,p_error text,p_reference text) returns void language sql security invoker set search_path='' as $$select private.finish_signals_collection_task(p_id,p_cost,p_usd,p_basis,p_counts,p_error,p_reference);$$;
revoke all on function private.claim_signals_collection_task(uuid,numeric),public.claim_signals_collection_task(uuid,numeric),private.finish_signals_collection_task(uuid,numeric,numeric,text,jsonb,text,text),public.finish_signals_collection_task(uuid,numeric,numeric,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.claim_signals_collection_task(uuid,numeric),public.claim_signals_collection_task(uuid,numeric),private.finish_signals_collection_task(uuid,numeric,numeric,text,jsonb,text,text),public.finish_signals_collection_task(uuid,numeric,numeric,text,jsonb,text,text) to service_role;
commit;
