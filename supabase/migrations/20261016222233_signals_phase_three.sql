begin;
alter table public.workspaces add column paused_reason text;
alter table public.workspaces add column budget_resume_status text;
alter table public.workspaces add column budget_resume_reason text;
create table public.client_budgets (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 period_start date not null,period_end date not null,amount numeric(14,6) not null check(amount>0),
 currency text not null default 'GBP' check(currency='GBP'),status text not null default 'active' check(status in ('active','spent','closed')),
 note text not null default '',is_test boolean not null default false,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(id,workspace_id),check(period_end>period_start)
);
create unique index client_budgets_current on public.client_budgets(workspace_id) where status<>'closed';
create table public.budget_history (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),budget_id uuid not null,
 action text not null check(action in ('create','renew','top_up','change')),previous_amount numeric(14,6),amount numeric(14,6) not null,note text not null default '',
 actor_id uuid not null references auth.users(id),actor_label text not null,created_at timestamptz not null default now(),
 foreign key(budget_id,workspace_id) references public.client_budgets(id,workspace_id)
);
create table public.cost_reservations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),budget_id uuid not null,
 request_key text not null,estimated_cost numeric(14,6) not null check(estimated_cost>0),status text not null default 'reserved' check(status in ('reserved','settled','cancelled')),
 created_at timestamptz not null default now(),unique(workspace_id,request_key),unique(id,workspace_id),
 foreign key(budget_id,workspace_id) references public.client_budgets(id,workspace_id)
);
create table public.cost_ledger (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),budget_id uuid not null,
 reservation_id uuid,profile_id uuid,run_id uuid,request_key text not null,stage text not null check(stage in ('find','collect','filter','triage','score','rewrite','find_person')),
 provider text not null,source_key text not null default '',model text,units jsonb not null default '{}' check(jsonb_typeof(units)='object'),
 cost numeric(14,6) not null check(cost>=0),currency text not null default 'GBP' check(currency='GBP'),cost_basis text not null check(cost_basis in ('reported','estimated')),
 outcome text not null check(outcome in ('success','failed')),batch boolean not null default false,cached boolean not null default false,
 is_test boolean not null default false,created_at timestamptz not null default now(),unique(workspace_id,request_key),
 foreign key(budget_id,workspace_id) references public.client_budgets(id,workspace_id),
 foreign key(reservation_id,workspace_id) references public.cost_reservations(id,workspace_id),
 foreign key(profile_id,workspace_id) references public.campaigns(id,workspace_id),
 foreign key(run_id,workspace_id) references public.search_runs(id,workspace_id)
);
create table public.budget_alerts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),budget_id uuid not null,
 threshold integer not null check(threshold in (80,100)),status text not null default 'pending' check(status in ('pending','sent','failed')),
 attempts integer not null default 0,last_error text,created_at timestamptz not null default now(),sent_at timestamptz,
 unique(budget_id,threshold),foreign key(budget_id,workspace_id) references public.client_budgets(id,workspace_id)
);
create table public.provider_pricing (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),pricing_key text not null,
 currency text not null default 'GBP' check(currency='GBP'),rates jsonb not null check(jsonb_typeof(rates)='object'),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),unique(workspace_id,pricing_key)
);
do $$ declare t text;begin foreach t in array array['client_budgets','budget_history','cost_reservations','cost_ledger','budget_alerts','provider_pricing'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform reads budget records" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);
 execute format('create index %I on public.%I(workspace_id)',t||'_workspace_idx',t);
 end loop;end $$;
create unique index cost_ledger_reservation_unique on public.cost_ledger(reservation_id) where reservation_id is not null;
create index cost_ledger_profile_idx on public.cost_ledger(profile_id);
create index cost_ledger_run_idx on public.cost_ledger(run_id);
create index budget_history_actor_idx on public.budget_history(actor_id);
create index client_budgets_creator_idx on public.client_budgets(created_by);
create index provider_pricing_updater_idx on public.provider_pricing(updated_by);
create index cost_ledger_budget_time on public.cost_ledger(budget_id,created_at);
create index budget_history_budget_time on public.budget_history(budget_id,created_at);
create index cost_reservations_budget_status on public.cost_reservations(budget_id,status);
create function private.immutable_budget_record() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Budget audit records are append-only';end;$$;
revoke all on function private.immutable_budget_record() from public,anon,authenticated;
create trigger immutable_cost_ledger before update or delete on public.cost_ledger for each row execute function private.immutable_budget_record();
create trigger immutable_budget_history before update or delete on public.budget_history for each row execute function private.immutable_budget_record();

create function private.refresh_budget_state(p_budget uuid) returns void language plpgsql security definer set search_path='' as $$
 declare b public.client_budgets; spent numeric;begin
 select * into b from public.client_budgets where id=p_budget for update;
 if not found or b.status='closed' then return;end if;
 select coalesce(sum(cost),0) into spent from public.cost_ledger where budget_id=b.id;
 if spent>=b.amount then
 update public.client_budgets set status='spent' where id=b.id;
 update public.workspaces set budget_resume_status=case when paused_reason like 'budget:%' then budget_resume_status else status end,
 budget_resume_reason=case when paused_reason like 'budget:%' then budget_resume_reason else paused_reason end,
 status='paused',paused_reason='budget:used up on '||(now() at time zone timezone)::date::text
 where id=b.workspace_id and status<>'archived';
 else
 update public.client_budgets set status='active' where id=b.id;
 update public.workspaces set status=coalesce(budget_resume_status,'setup'),paused_reason=budget_resume_reason,budget_resume_status=null,budget_resume_reason=null
 where id=b.workspace_id and status='paused' and paused_reason like 'budget:%';
 end if;
 if spent>=b.amount*.8 then insert into public.budget_alerts(workspace_id,budget_id,threshold) values(b.workspace_id,b.id,80) on conflict do nothing;end if;
 if spent>=b.amount then insert into public.budget_alerts(workspace_id,budget_id,threshold) values(b.workspace_id,b.id,100) on conflict do nothing;end if;
 end;$$;
revoke all on function private.refresh_budget_state(uuid) from public,anon,authenticated;

create function private.change_signals_budget(p_workspace uuid,p_action text,p_amount numeric,p_start date,p_end date,p_note text,p_test boolean) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare b public.client_budgets;bid uuid;old_amount numeric;total numeric;begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace and is_signals_client and status<>'archived' for update;
 if not found then raise exception 'Client unavailable';end if;
 if p_action is null or p_action not in ('create','renew','top_up','change') or p_amount is null or p_amount<=0 or p_amount>1000000 then raise exception 'Enter a positive amount up to £1,000,000';end if;
 if length(coalesce(p_note,''))>2000 then raise exception 'Note is too long';end if;
 select * into b from public.client_budgets where workspace_id=p_workspace and status<>'closed' for update;
 if p_action in ('create','renew') then
 if p_start is null or p_end is null or p_end<=p_start then raise exception 'Choose a valid period';end if;
 if p_action='create' and b.id is not null then raise exception 'A current budget already exists. Use renew.';end if;
 if b.id is not null and exists(select 1 from public.cost_reservations where budget_id=b.id and status='reserved') then raise exception 'Resolve pending calls before renewing';end if;
 update public.client_budgets set status='closed' where id=b.id;
 insert into public.client_budgets(workspace_id,period_start,period_end,amount,note,is_test,created_by)
 values(p_workspace,p_start,p_end,p_amount,coalesce(p_note,''),coalesce(p_test,false),auth.uid()) returning id into bid;
 else
 if b.id is null then raise exception 'Create a budget first';end if;
 old_amount:=b.amount;total:=case when p_action='top_up' then b.amount+p_amount else p_amount end;
 if total<(select coalesce(sum(cost),0) from public.cost_ledger where budget_id=b.id)+(select coalesce(sum(estimated_cost),0) from public.cost_reservations where budget_id=b.id and status='reserved') then raise exception 'Budget cannot be smaller than spent and reserved costs';end if;
 update public.client_budgets set amount=total,note=coalesce(p_note,'') where id=b.id;bid:=b.id;
 end if;
 insert into public.budget_history(workspace_id,budget_id,action,previous_amount,amount,note,actor_id,actor_label)
 select p_workspace,bid,p_action,old_amount,amount,coalesce(p_note,''),auth.uid(),coalesce((select email from auth.users where id=auth.uid()),'Platform admin') from public.client_budgets where id=bid;
 perform private.refresh_budget_state(bid);return bid;end;$$;

create function private.reserve_signals_cost(p_workspace uuid,p_request_key text,p_estimate numeric,p_optional boolean,p_test boolean default false) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare b public.client_budgets;spent numeric;held numeric;today_spend numeric;days_left integer;local_today date;rid uuid;existing public.cost_reservations;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace and is_signals_client and status not in ('paused','archived') for update;
 if not found then raise exception 'Client is paused or unavailable';end if;
 select * into existing from public.cost_reservations where workspace_id=p_workspace and request_key=p_request_key;
 if found then raise exception 'Request already reserved or settled';end if;
 select * into b from public.client_budgets where workspace_id=p_workspace and status<>'closed' for update;
 select (now() at time zone timezone)::date into local_today from public.workspaces where id=p_workspace;
 if b.id is null or b.status<>'active' or local_today<b.period_start or local_today>=b.period_end then raise exception 'No active budget for today';end if;
 if b.is_test<>coalesce(p_test,false) then raise exception 'Test budgets only allow explicit fake costs';end if;
 if p_estimate is null or p_estimate<=0 or length(coalesce(p_request_key,'')) not between 1 and 200 then raise exception 'Invalid reservation';end if;
 select coalesce(sum(cost),0) into spent from public.cost_ledger where budget_id=b.id;
 select coalesce(sum(estimated_cost),0) into held from public.cost_reservations where budget_id=b.id and status='reserved';
 if p_estimate>b.amount-spent-held then raise exception 'Hard cap: insufficient budget';end if;
 select coalesce(sum(l.cost),0) into today_spend from public.cost_ledger l join public.workspaces w on w.id=l.workspace_id
 where l.budget_id=b.id and (l.created_at at time zone w.timezone)::date=local_today;
 days_left:=greatest(b.period_end-local_today,1);
 if coalesce(p_optional,false) and today_spend+held+p_estimate>(b.amount-spent)/days_left then raise exception 'Daily soft cap: optional work paused';end if;
 insert into public.cost_reservations(workspace_id,budget_id,request_key,estimated_cost) values(p_workspace,b.id,p_request_key,p_estimate) returning id into rid;return rid;end;$$;

create function private.settle_signals_cost(p_reservation uuid,p_cost numeric,p_details jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
 declare r public.cost_reservations;lid uuid;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 -- Workspace then budget then reservation: same lock order as all budget writes.
 perform 1 from public.workspaces where id=(select workspace_id from public.cost_reservations where id=p_reservation) for update;
 select * into r from public.cost_reservations where id=p_reservation;
 if r.id is null then raise exception 'Reservation unavailable';end if;
 perform 1 from public.client_budgets where id=r.budget_id for update;
 select * into r from public.cost_reservations where id=p_reservation for update;
 if r.status='settled' then select id into lid from public.cost_ledger where reservation_id=r.id;return lid;end if;
 if r.status<>'reserved' or p_cost is null or p_cost<0 then raise exception 'Invalid settlement';end if;
 -- Actual charges, including failures and overruns, must always be recorded.
 insert into public.cost_ledger(workspace_id,budget_id,reservation_id,request_key,profile_id,run_id,stage,provider,source_key,model,units,cost,cost_basis,outcome,batch,cached,is_test)
 values(r.workspace_id,r.budget_id,r.id,r.request_key,(p_details->>'profile_id')::uuid,(p_details->>'run_id')::uuid,p_details->>'stage',p_details->>'provider',coalesce(p_details->>'source_key',''),p_details->>'model',coalesce(p_details->'units','{}'),p_cost,p_details->>'cost_basis',p_details->>'outcome',coalesce((p_details->>'batch')::boolean,false),coalesce((p_details->>'cached')::boolean,false),(select is_test from public.client_budgets where id=r.budget_id)) returning id into lid;
 update public.cost_reservations set status='settled' where id=r.id;perform private.refresh_budget_state(r.budget_id);return lid;end;$$;
create function private.cancel_signals_cost(p_reservation uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.cost_reservations where id=p_reservation) for update;
 update public.cost_reservations set status='cancelled' where id=p_reservation and status='reserved';end;$$;
create function private.add_signals_test_cost(p_workspace uuid,p_amount numeric,p_key text) returns uuid language plpgsql security definer set search_path='' as $$declare r uuid;begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace and is_signals_client for update;
 if not exists(select 1 from public.client_budgets where workspace_id=p_workspace and status='active' and is_test) then raise exception 'Fake costs are only allowed on an active test budget';end if;
 r:=private.reserve_signals_cost(p_workspace,p_key,p_amount,false,true);
 return private.settle_signals_cost(r,p_amount,'{"stage":"collect","provider":"test","source_key":"manual-test","units":{"fake_calls":1},"cost_basis":"estimated","outcome":"success"}');end;$$;

create function private.signals_budget_overview(p_workspace uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when private.is_platform_admin() then (
 select jsonb_build_object('budget',to_jsonb(b),'spent',coalesce((select sum(cost) from public.cost_ledger where budget_id=b.id),0),
 'reserved',coalesce((select sum(estimated_cost) from public.cost_reservations where budget_id=b.id and status='reserved'),0),
 'today_spent',coalesce((select sum(l.cost) from public.cost_ledger l where budget_id=b.id and (l.created_at at time zone w.timezone)::date=(now() at time zone w.timezone)::date),0),
 'days_left',greatest(b.period_end-(now() at time zone w.timezone)::date,1)) from public.client_budgets b join public.workspaces w on w.id=b.workspace_id where b.workspace_id=p_workspace and b.status<>'closed') else null end;$$;
create function private.pending_signals_budget_alerts(p_workspace uuid) returns table(id uuid,threshold integer,is_test boolean,client_name text,amount numeric,recipients jsonb)
 language sql stable security definer set search_path='' as $$select a.id,a.threshold,b.is_test,w.name,b.amount,
 (select jsonb_agg(u.email) from public.platform_admins p join auth.users u on u.id=p.user_id where p.active and u.email_confirmed_at is not null)
 from public.budget_alerts a join public.client_budgets b on b.id=a.budget_id join public.workspaces w on w.id=a.workspace_id
 where a.workspace_id=p_workspace and a.status<>'sent' and (private.is_platform_admin() or coalesce(auth.jwt()->>'role','')='service_role');$$;
create function private.mark_signals_budget_alert(p_id uuid,p_sent boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed' using errcode='42501';end if;
 update public.budget_alerts set status=case when p_sent then 'sent' else 'failed' end,attempts=attempts+1,last_error=case when p_sent then null else 'Email delivery failed; retry available' end,sent_at=case when p_sent then now() else null end where id=p_id and status<>'sent';end;$$;
create function private.save_signals_pricing(p_workspace uuid,p_key text,p_rates jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501';end if;
 if exists(select 1 from jsonb_each(p_rates) x where case when jsonb_typeof(x.value)='number' then (x.value::text)::numeric<0 else true end) then raise exception 'Rates must be nonnegative numbers';end if;
 if length(trim(coalesce(p_key,''))) not between 1 and 120 or jsonb_typeof(p_rates)<>'object' or p_rates is null then raise exception 'Enter a pricing key and JSON object';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and is_signals_client) then raise exception 'Client unavailable';end if;
 insert into public.provider_pricing(workspace_id,pricing_key,rates,updated_by) values(p_workspace,trim(p_key),p_rates,auth.uid()) on conflict(workspace_id,pricing_key) do update set rates=excluded.rates,updated_by=excluded.updated_by,updated_at=now();end;$$;

create function public.change_signals_budget(p_workspace uuid,p_action text,p_amount numeric,p_start date,p_end date,p_note text,p_test boolean) returns uuid language sql security invoker set search_path='' as $$select private.change_signals_budget(p_workspace,p_action,p_amount,p_start,p_end,p_note,p_test);$$;
create function public.reserve_signals_cost(p_workspace uuid,p_request_key text,p_estimate numeric,p_optional boolean) returns uuid language sql security invoker set search_path='' as $$select private.reserve_signals_cost(p_workspace,p_request_key,p_estimate,p_optional);$$;
create function public.settle_signals_cost(p_reservation uuid,p_cost numeric,p_details jsonb) returns uuid language sql security invoker set search_path='' as $$select private.settle_signals_cost(p_reservation,p_cost,p_details);$$;
create function public.cancel_signals_cost(p_reservation uuid) returns void language sql security invoker set search_path='' as $$select private.cancel_signals_cost(p_reservation);$$;
create function public.add_signals_test_cost(p_workspace uuid,p_amount numeric,p_key text) returns uuid language sql security invoker set search_path='' as $$select private.add_signals_test_cost(p_workspace,p_amount,p_key);$$;
create function public.signals_budget_overview(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$select private.signals_budget_overview(p_workspace);$$;
create function public.pending_signals_budget_alerts(p_workspace uuid) returns table(id uuid,threshold integer,is_test boolean,client_name text,amount numeric,recipients jsonb) language sql security invoker set search_path='' as $$select * from private.pending_signals_budget_alerts(p_workspace);$$;
create function public.mark_signals_budget_alert(p_id uuid,p_sent boolean) returns void language sql security invoker set search_path='' as $$select private.mark_signals_budget_alert(p_id,p_sent);$$;
create function public.save_signals_pricing(p_workspace uuid,p_key text,p_rates jsonb) returns void language sql security invoker set search_path='' as $$select private.save_signals_pricing(p_workspace,p_key,p_rates);$$;
do $$declare fn text;begin foreach fn in array array['change_signals_budget(uuid,text,numeric,date,date,text,boolean)','reserve_signals_cost(uuid,text,numeric,boolean)','settle_signals_cost(uuid,numeric,jsonb)','cancel_signals_cost(uuid)','add_signals_test_cost(uuid,numeric,text)','signals_budget_overview(uuid)','pending_signals_budget_alerts(uuid)','mark_signals_budget_alert(uuid,boolean)','save_signals_pricing(uuid,text,jsonb)'] loop
 execute 'revoke all on function private.'||replace(fn,'reserve_signals_cost(uuid,text,numeric,boolean)','reserve_signals_cost(uuid,text,numeric,boolean,boolean)')||' from public,anon';execute 'revoke all on function public.'||fn||' from public,anon';
 execute 'grant execute on function private.'||replace(fn,'reserve_signals_cost(uuid,text,numeric,boolean)','reserve_signals_cost(uuid,text,numeric,boolean,boolean)')||' to authenticated,service_role';execute 'grant execute on function public.'||fn||' to authenticated,service_role';end loop;end $$;
commit;
