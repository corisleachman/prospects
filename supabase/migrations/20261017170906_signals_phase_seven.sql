begin;
-- Neutral client entities are separate from the legacy CRM. Existing agency/contact
-- records retain their original match checks and generated score fields.
alter table public.signals alter column agency_id drop not null;
alter table public.signals add column company_id uuid references public.companies(id);
alter table public.signals add column person_id uuid references public.people(id);
alter table public.signals add constraint signals_entity_required check(agency_id is not null or company_id is not null);
alter table public.signals add foreign key(person_id,company_id) references public.people(id,company_id);
create index signals_company_idx on public.signals(company_id);
create index signals_person_idx on public.signals(person_id);
alter table public.campaign_signals alter column contact_id drop not null;
alter table public.campaign_signals alter column entity_match_id drop not null;
alter table public.campaign_signals add column company_id uuid references public.companies(id);
alter table public.campaign_signals add column person_id uuid references public.people(id);
alter table public.campaign_signals add column relevance smallint check(relevance between 0 and 10);
alter table public.campaign_signals add column polarity text check(polarity in ('positive','negative','neutral'));
alter table public.campaign_signals add column pipeline_run_id uuid references public.search_runs(id);
alter table public.campaign_signals add column fresh_until timestamptz;
alter table public.campaign_signals add column is_test boolean not null default false;
alter table public.campaign_signals add constraint product_or_legacy_card check((contact_id is not null and entity_match_id is not null) or (contact_id is null and entity_match_id is null and company_id is not null));
alter table public.campaign_signals add foreign key(person_id,company_id) references public.people(id,company_id);
create unique index campaign_product_signal_unique on public.campaign_signals(campaign_id,signal_id,pipeline_run_id) where company_id is not null;
create index campaign_card_company on public.campaign_signals(company_id);
create index campaign_card_person on public.campaign_signals(person_id);
create index campaign_card_pipeline on public.campaign_signals(pipeline_run_id);
create or replace function private.validate_campaign_signal_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  signal_agency_id uuid;
begin
  if new.contact_id is null and new.entity_match_id is null and new.company_id is not null then
    if not exists(select 1 from public.signals s join public.workspaces w on w.id=s.workspace_id where s.id=new.signal_id and s.workspace_id=new.workspace_id and s.company_id=new.company_id and w.is_signals_client) then raise exception 'Product card requires its own client company signal';end if;
    if new.person_id is not null and not exists(select 1 from public.people p where p.id=new.person_id and p.company_id=new.company_id) then raise exception 'Person must belong to the signal company';end if;
    return new;
  end if;
  select s.agency_id
    into signal_agency_id
    from public.signals s
    where s.id = new.signal_id
      and s.workspace_id = new.workspace_id;

  if signal_agency_id is null then
    raise exception 'Campaign signal must reference a signal in the same workspace';
  end if;

  if not exists (
    select 1
    from public.entity_matches m
    join public.signal_sources ss
      on ss.evidence_item_id = m.evidence_item_id
     and ss.signal_id = new.signal_id
     and ss.workspace_id = new.workspace_id
    where m.id = new.entity_match_id
      and m.workspace_id = new.workspace_id
      and m.agency_id = signal_agency_id
      and m.contact_id = new.contact_id
      and m.decision = 'accepted'
  ) then
    raise exception 'Campaign signal requires an accepted match from its supporting evidence';
  end if;

  return new;
end
$$;


create table public.pipeline_runs(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),
 status text not null default 'collecting' check(status in ('collecting','triage','score','ready','partial','failed')),
 snapshot jsonb not null,fingerprint text not null,fallback_at timestamptz not null,
 samples_reviewed boolean not null default false,lease_until timestamptz,summary jsonb not null default '{}',error_summary text,
 created_at timestamptz not null default now(),completed_at timestamptz,
 unique(id,workspace_id),foreign key(id,workspace_id) references public.collection_runs(id,workspace_id)
);
alter table public.pipeline_runs add column published boolean not null default false;
create index pipeline_runs_workspace on public.pipeline_runs(workspace_id,created_at desc);
create table public.pipeline_jobs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),run_id uuid not null,
 item_id uuid not null,stage text not null check(stage in ('triage','score')),
 status text not null default 'pending' check(status in ('pending','submitted','succeeded','dropped','failed','budget_paused')),
 input jsonb not null default '{}',result jsonb,error_summary text,configuration_errors jsonb not null default '[]',
 profile_id uuid,company_id uuid references public.companies(id),person_id uuid references public.people(id),
 fallback_variant boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(run_id,item_id,stage),unique(id,workspace_id),
 foreign key(run_id,workspace_id) references public.pipeline_runs(id,workspace_id),foreign key(item_id,workspace_id) references public.collection_items(id,workspace_id),
 foreign key(profile_id,workspace_id) references public.campaigns(id,workspace_id)
);
create index pipeline_jobs_workspace_run on public.pipeline_jobs(workspace_id,run_id,stage,status);
create index pipeline_jobs_item on public.pipeline_jobs(item_id,workspace_id);
create index pipeline_jobs_profile on public.pipeline_jobs(profile_id,workspace_id);
create index pipeline_jobs_company on public.pipeline_jobs(company_id);
create index pipeline_jobs_person on public.pipeline_jobs(person_id);
create table public.pipeline_batches(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),run_id uuid not null,stage text not null check(stage in ('triage','score')),
 provider_id text,status text not null default 'creating' check(status in ('creating','processing','canceling','ended','failed','uncertain')),
 error_summary text,created_at timestamptz not null default now(),unique(id,workspace_id),foreign key(run_id,workspace_id) references public.pipeline_runs(id,workspace_id)
);
create index pipeline_batches_workspace on public.pipeline_batches(workspace_id,run_id,status);
create table public.pipeline_ai_calls(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),run_id uuid not null,job_id uuid not null,batch_id uuid,
 mode text not null check(mode in ('batch','live')),params jsonb not null,rates jsonb not null,fx numeric not null check(fx>0),
 reservation_id uuid not null,status text not null default 'reserved' check(status in ('reserved','submitted','succeeded','failed','canceled','uncertain')),
 usage jsonb,cost_gbp numeric(14,6),stop_reason text,error_summary text,created_at timestamptz not null default now(),completed_at timestamptz,
 unique(id,workspace_id),foreign key(reservation_id,workspace_id) references public.cost_reservations(id,workspace_id),foreign key(job_id,workspace_id) references public.pipeline_jobs(id,workspace_id),foreign key(run_id,workspace_id) references public.pipeline_runs(id,workspace_id),foreign key(batch_id,workspace_id) references public.pipeline_batches(id,workspace_id)
);
create index pipeline_calls_workspace_run on public.pipeline_ai_calls(workspace_id,run_id);
create index pipeline_calls_job on public.pipeline_ai_calls(job_id,workspace_id);
create index pipeline_calls_batch on public.pipeline_ai_calls(batch_id,workspace_id);
create index pipeline_calls_reservation on public.pipeline_ai_calls(reservation_id);
create table public.message_drafts(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),card_id uuid not null,
 channel text not null check(channel in ('email','linkedin')),subject text,body text not null,version integer not null check(version between 1 and 4),model text not null,
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(card_id,channel,version),unique(id,workspace_id),
 foreign key(card_id,workspace_id) references public.campaign_signals(id,workspace_id)
);
create index drafts_workspace_card on public.message_drafts(workspace_id,card_id);
create index drafts_creator on public.message_drafts(created_by);
alter table public.workspaces add column first_morning_at timestamptz;
alter table public.workspaces add column next_pipeline_run_at timestamptz;
alter table public.workspaces add column last_pipeline_local_date date;
alter table public.workspaces add column latest_pipeline_test_id uuid references public.pipeline_runs(id);
create index workspace_pipeline_test on public.workspaces(latest_pipeline_test_id);
do $$declare t text;begin foreach t in array array['pipeline_runs','pipeline_jobs','pipeline_batches','pipeline_ai_calls','message_drafts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform reads pipeline" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);
 end loop;end $$;
alter table public.provider_pricing drop constraint provider_pricing_currency_check;
alter table public.provider_pricing add constraint provider_pricing_currency_check check(currency in ('GBP','USD'));
alter table public.provider_pricing add column pricing_source text;
alter table public.provider_pricing add column verified_on date;
create function private.signals_setup_fingerprint(p_workspace uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('workspace',(select jsonb_build_object('timezone',timezone) from public.workspaces where id=p_workspace),
 'profiles',(select jsonb_agg(jsonb_build_array(id,setup_revision,watch_revision,status) order by id) from public.campaigns where workspace_id=p_workspace),
 'rules',(select jsonb_agg(jsonb_build_array(id,setup_revision,is_active,deleted_at) order by id) from public.signal_definitions where workspace_id=p_workspace),
 'sources',(select jsonb_agg(jsonb_build_array(source_key,setup_revision) order by source_key) from public.workspace_source_settings where workspace_id=p_workspace),
 'extra',(select jsonb_agg(jsonb_build_array(id,setup_revision,validation_status,deleted_at) order by id) from public.client_extra_sources where workspace_id=p_workspace),
 'voice',(select jsonb_agg(jsonb_build_array(id,setup_revision) order by id) from public.voice_profiles where workspace_id=p_workspace))::text);$$;
revoke all on function private.signals_setup_fingerprint(uuid) from public,anon,authenticated;
create function private.signals_pipeline_setup(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.is_platform_admin() and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and is_signals_client and status<>'archived') then raise exception 'Client unavailable';end if;
 select jsonb_build_object('fingerprint',private.signals_setup_fingerprint(p_workspace),'profiles',(select coalesce(jsonb_agg(c order by c.created_at),'[]') from public.campaigns c where c.workspace_id=p_workspace and c.status<>'archived'),
 'rules',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('profile_ids',(select coalesce(jsonb_agg(campaign_id),'[]') from public.campaign_signal_rules s where s.signal_definition_id=d.id and s.workspace_id=p_workspace)) order by d.created_at),'[]') from public.signal_definitions d where d.workspace_id=p_workspace and d.deleted_at is null),
 'voice',(select to_jsonb(v) from public.voice_profiles v where v.workspace_id=p_workspace and v.user_id is null),
 'delivery',(select coalesce(jsonb_agg(d),'[]') from public.delivery_rules d where d.workspace_id=p_workspace and d.enabled)) into result;return result;end;$$;
create function public.signals_pipeline_setup(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$select private.signals_pipeline_setup(p_workspace);$$;
revoke all on function private.signals_pipeline_setup(uuid),public.signals_pipeline_setup(uuid) from public,anon;
grant execute on function private.signals_pipeline_setup(uuid),public.signals_pipeline_setup(uuid) to authenticated,service_role;
create function private.save_signals_pricing_currency(p_workspace uuid,p_key text,p_currency text,p_rates jsonb,p_source text,p_verified date) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_signals_setup_admin(p_workspace);
 if p_currency not in ('USD','GBP') or jsonb_typeof(p_rates)<>'object' or p_rates is null or length(trim(coalesce(p_key,''))) not between 1 and 120 then raise exception 'Choose a currency, pricing key and JSON object';end if;
 if exists(select 1 from jsonb_each(p_rates) x where case when jsonb_typeof(x.value)='number' then (x.value::text)::numeric<0 else true end) then raise exception 'Rates must be nonnegative numbers';end if;
 insert into public.provider_pricing(workspace_id,pricing_key,currency,rates,updated_by,pricing_source,verified_on) values(p_workspace,p_key,p_currency,p_rates,auth.uid(),nullif(p_source,''),p_verified) on conflict(workspace_id,pricing_key) do update set currency=excluded.currency,rates=excluded.rates,updated_by=excluded.updated_by,pricing_source=excluded.pricing_source,verified_on=excluded.verified_on,updated_at=now();end;$$;
create function public.save_signals_pricing_currency(p_workspace uuid,p_key text,p_currency text,p_rates jsonb,p_source text,p_verified date) returns void language sql security invoker set search_path='' as $$select private.save_signals_pricing_currency(p_workspace,p_key,p_currency,p_rates,p_source,p_verified);$$;
revoke all on function private.save_signals_pricing_currency(uuid,text,text,jsonb,text,date),public.save_signals_pricing_currency(uuid,text,text,jsonb,text,date) from public,anon;
grant execute on function private.save_signals_pricing_currency(uuid,text,text,jsonb,text,date),public.save_signals_pricing_currency(uuid,text,text,jsonb,text,date) to authenticated;

create function private.seed_signals_ai_pricing(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$declare actor uuid;begin
 select user_id into actor from public.platform_admins where active order by created_at limit 1;if actor is null then return;end if;
 insert into public.provider_pricing(workspace_id,pricing_key,currency,rates,updated_by,pricing_source,verified_on) values(p_workspace,'anthropic/claude-haiku-5-5','USD',$rates${"input_per_million": 0.1, "output_per_million": 0.5, "cache_read_per_million": 0.01, "cache_write_per_million": 0.125, "cache_write_1h_per_million": 0.2, "batch_multiplier": 0.5}$rates$::jsonb,actor,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-17') on conflict(workspace_id,pricing_key) do nothing;
 insert into public.provider_pricing(workspace_id,pricing_key,currency,rates,updated_by,pricing_source,verified_on) values(p_workspace,'anthropic/claude-sonnet-5-5','USD',$rates${"input_per_million": 2, "output_per_million": 10, "cache_read_per_million": 0.1, "cache_write_per_million": 2.5, "cache_write_1h_per_million": 4, "batch_multiplier": 0.5}$rates$::jsonb,actor,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-17') on conflict(workspace_id,pricing_key) do nothing;
end;$$;
revoke all on function private.seed_signals_ai_pricing(uuid) from public,anon,authenticated;
create function private.seed_signals_ai_trigger() returns trigger language plpgsql security definer set search_path='' as $$begin if new.is_signals_client then perform private.seed_signals_ai_pricing(new.id);end if;return new;end;$$;
revoke all on function private.seed_signals_ai_trigger() from public,anon,authenticated;
create trigger seed_signals_ai after insert on public.workspaces for each row execute function private.seed_signals_ai_trigger();
select private.seed_signals_ai_pricing(id) from public.workspaces where is_signals_client;
create function private.reserve_signals_ai_call(p_job uuid,p_call uuid,p_mode text,p_params jsonb,p_rates jsonb,p_fx numeric,p_cap numeric,p_batch uuid) returns uuid language plpgsql security definer set search_path='' as $$declare j public.pipeline_jobs;reservation uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.pipeline_jobs where id=p_job) for update;
 select * into j from public.pipeline_jobs where id=p_job for update;
 if j.id is null or j.status in ('succeeded','dropped') then return null;end if;
 if exists(select 1 from public.pipeline_ai_calls where job_id=p_job and mode=p_mode and status in ('reserved','submitted','uncertain')) then return null;end if;
 if p_mode='live' and now()<(select fallback_at from public.pipeline_runs where id=j.run_id) then raise exception 'Live fallback is not due';end if;
 reservation:=private.reserve_signals_cost(j.workspace_id,'ai:'||p_call::text,p_cap,coalesce((j.input->>'optional')::boolean,true));
 insert into public.pipeline_ai_calls(id,workspace_id,run_id,job_id,batch_id,mode,params,rates,fx,reservation_id) values(p_call,j.workspace_id,j.run_id,j.id,p_batch,p_mode,p_params,p_rates,p_fx,reservation);
 update public.pipeline_jobs set status='submitted',updated_at=now() where id=j.id;return p_call;end;$$;
create function public.reserve_signals_ai_call(p_job uuid,p_call uuid,p_mode text,p_params jsonb,p_rates jsonb,p_fx numeric,p_cap numeric,p_batch uuid) returns uuid language sql security invoker set search_path='' as $$select private.reserve_signals_ai_call(p_job,p_call,p_mode,p_params,p_rates,p_fx,p_cap,p_batch);$$;
create function private.settle_signals_ai_call(p_call uuid,p_cost numeric,p_usage jsonb,p_status text,p_stop text,p_error text,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$declare c public.pipeline_ai_calls;j public.pipeline_jobs;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.pipeline_ai_calls where id=p_call) for update;
 select * into c from public.pipeline_ai_calls where id=p_call for update;if c.id is null then raise exception 'AI call unavailable';end if;if c.completed_at is not null then return;end if;
 if p_status not in ('succeeded','failed','canceled') then raise exception 'Invalid final call status';end if;
 select * into j from public.pipeline_jobs where id=c.job_id for update;
 perform private.settle_signals_cost(c.reservation_id,p_cost,jsonb_build_object('stage',j.stage,'provider','anthropic','source_key',coalesce(j.input->>'source_key',''),'model',c.params->>'model','profile_id',j.profile_id,'run_id',j.run_id,'units',coalesce(p_usage,'{}')||jsonb_build_object('stop_reason',p_stop,'call_id',c.id),'cost_basis',case when p_usage is null then 'estimated' else 'reported' end,'outcome',case when p_status='succeeded' then 'success' else 'failed' end,'batch',c.mode='batch','cached',coalesce((p_usage->>'cache_read_input_tokens')::integer,0)>0));
 update public.pipeline_ai_calls set status=p_status,usage=p_usage,cost_gbp=p_cost,stop_reason=p_stop,error_summary=p_error,completed_at=now() where id=c.id;
 if p_status='succeeded' and j.status not in ('succeeded','dropped') then update public.pipeline_jobs set status='succeeded',result=p_result,error_summary=null,updated_at=now() where id=j.id;
 elsif p_status<>'succeeded' and j.status not in ('succeeded','dropped') and not exists(select 1 from public.pipeline_ai_calls where job_id=j.id and id<>c.id and status in ('reserved','submitted','uncertain')) then update public.pipeline_jobs set status='failed',error_summary=p_error,updated_at=now() where id=j.id;end if;
 end;$$;
create function public.settle_signals_ai_call(p_call uuid,p_cost numeric,p_usage jsonb,p_status text,p_stop text,p_error text,p_result jsonb) returns void language sql security invoker set search_path='' as $$select private.settle_signals_ai_call(p_call,p_cost,p_usage,p_status,p_stop,p_error,p_result);$$;
revoke all on function private.reserve_signals_ai_call(uuid,uuid,text,jsonb,jsonb,numeric,numeric,uuid),public.reserve_signals_ai_call(uuid,uuid,text,jsonb,jsonb,numeric,numeric,uuid),private.settle_signals_ai_call(uuid,numeric,jsonb,text,text,text,jsonb),public.settle_signals_ai_call(uuid,numeric,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.reserve_signals_ai_call(uuid,uuid,text,jsonb,jsonb,numeric,numeric,uuid),public.reserve_signals_ai_call(uuid,uuid,text,jsonb,jsonb,numeric,numeric,uuid),private.settle_signals_ai_call(uuid,numeric,jsonb,text,text,text,jsonb),public.settle_signals_ai_call(uuid,numeric,jsonb,text,text,text,jsonb) to service_role;
alter table public.pipeline_jobs add column promoted boolean not null default false;
create table public.card_deliveries(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),user_id uuid not null,card_id uuid not null,
 local_day date not null,position integer not null check(position>0),state text not null default 'open' check(state in ('open','sent','replied','dismissed')),
 no_repeat_until date not null,sent_at timestamptz,replied_at timestamptz,dismissed_at timestamptz,
 created_at timestamptz not null default now(),unique(user_id,card_id),unique(workspace_id,user_id,local_day,position),unique(id,workspace_id),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id),foreign key(card_id,workspace_id) references public.campaign_signals(id,workspace_id)
);
create index card_delivery_workspace_day on public.card_deliveries(workspace_id,local_day,user_id);
create index card_delivery_card on public.card_deliveries(card_id,workspace_id);
alter table public.card_deliveries enable row level security;
revoke all on public.card_deliveries from public,anon,authenticated;grant select on public.card_deliveries to authenticated;grant all on public.card_deliveries to service_role;
create policy "platform reads deliveries" on public.card_deliveries for select to authenticated using((select private.is_platform_admin()));
create function private.publish_signals_cards(p_run uuid,p_day date) returns integer language plpgsql security definer set search_path='' as $$declare w uuid;r public.delivery_rules;c record;pos integer;n integer:=0;sensitive integer;seen uuid[];begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 select workspace_id into w from public.pipeline_runs where id=p_run;
 perform 1 from public.workspaces where id=w and status='live' for update;if not found then return 0;end if;
 if exists(select 1 from public.collection_runs where id=p_run and kind='test') then return 0;end if;
 for r in select d.* from public.delivery_rules d join public.workspace_members m on m.workspace_id=d.workspace_id and m.user_id=d.user_id and m.status='active' where d.workspace_id=w and d.enabled and d.user_id is not null loop
 select coalesce(max(position),0),count(*) filter(where cs.polarity='negative'),coalesce(array_agg(cs.person_id) filter(where cs.person_id is not null),'{}') into pos,sensitive,seen from public.card_deliveries cd join public.campaign_signals cs on cs.id=cd.card_id where cd.workspace_id=w and cd.user_id=r.user_id and cd.local_day=p_day;
 for c in select cs.* from public.campaign_signals cs join public.signals s on s.id=cs.signal_id join public.evidence_items e on e.id=s.primary_evidence_item_id where cs.workspace_id=w and cs.pipeline_run_id=p_run and not cs.is_test and cs.relevance>=7 and cs.campaign_id=any(r.profile_ids) and cs.fresh_until>now() order by (cs.polarity='negative'),cs.relevance desc,cs.created_at,cs.id loop
 if pos>=r.max_cards_per_day then exit;end if;
 if c.polarity='negative' and (sensitive>=1 or pos=0 or not exists(select 1 from public.signal_definitions where workspace_id=w and template_key='layoffs' and is_active and deleted_at is null)) then continue;end if;
 if c.person_id is not null and (c.person_id=any(seen) or exists(select 1 from public.card_deliveries cd join public.campaign_signals prior on prior.id=cd.card_id where cd.workspace_id=w and cd.user_id=r.user_id and prior.person_id=c.person_id and cd.no_repeat_until>p_day)) then continue;end if;
 if exists(select 1 from public.card_deliveries where user_id=r.user_id and card_id=c.id) then continue;end if;
 pos:=pos+1;insert into public.card_deliveries(workspace_id,user_id,card_id,local_day,position,no_repeat_until) values(w,r.user_id,c.id,p_day,pos,p_day+r.no_repeat_days);n:=n+1;if c.polarity='negative' then sensitive:=sensitive+1;end if;if c.person_id is not null then seen:=array_append(seen,c.person_id);end if;
 end loop;end loop;return n;end;$$;
create function public.publish_signals_cards(p_run uuid,p_day date) returns integer language sql security invoker set search_path='' as $$select private.publish_signals_cards(p_run,p_day);$$;
revoke all on function private.publish_signals_cards(uuid,date),public.publish_signals_cards(uuid,date) from public,anon,authenticated;grant execute on function private.publish_signals_cards(uuid,date),public.publish_signals_cards(uuid,date) to service_role;
create function private.review_signals_test(p_workspace uuid,p_run uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_signals_setup_admin(p_workspace);
 update public.pipeline_runs p set samples_reviewed=true where p.id=p_run and p.workspace_id=p_workspace and p.status in ('ready','partial') and p.fingerprint=private.signals_setup_fingerprint(p_workspace) and exists(select 1 from public.collection_runs where id=p.id and kind='test');if not found then raise exception 'Run a test with the current setup first';end if;end;$$;
create function public.review_signals_test(p_workspace uuid,p_run uuid) returns void language sql security invoker set search_path='' as $$select private.review_signals_test(p_workspace,p_run);$$;
create function private.go_live_signals(p_workspace uuid,p_run uuid,p_first timestamptz,p_next timestamptz) returns void language plpgsql security definer set search_path='' as $$declare v public.voice_profiles;begin
 perform private.require_signals_setup_admin(p_workspace);
 if not exists(select 1 from public.pipeline_runs where id=p_run and workspace_id=p_workspace and status in ('ready','partial') and samples_reviewed and created_at>now()-interval '24 hours' and fingerprint=private.signals_setup_fingerprint(p_workspace)) then raise exception 'Review a fresh test of the current setup before going live';end if;
 select * into v from public.voice_profiles where workspace_id=p_workspace and user_id is null;
 if (select count(*) from regexp_split_to_table(v.examples_text,E'\n[ \t]*---[ \t]*\r?\n') part where trim(part)<>'') not between 3 and 10 or cardinality(v.channels)=0 then raise exception 'Add 3–10 real messages and choose at least one channel';end if;
 if not exists(select 1 from public.delivery_rules d join public.workspace_members m on m.workspace_id=d.workspace_id and m.user_id=d.user_id and m.status='active' where d.workspace_id=p_workspace and d.enabled and cardinality(d.profile_ids)>0) then raise exception 'Invite an active recipient and choose their profiles first';end if;
 if exists(select 1 from public.campaigns where workspace_id=p_workspace and status<>'archived' and (trim(who)='' or trim(relevant_moment)='' or trim(conversation_to_open)='')) then raise exception 'Complete each profile description, relevant moment and conversation';end if;
 if not exists(select 1 from public.workspace_source_settings where workspace_id=p_workspace and enabled) or not exists(select 1 from public.signal_definitions where workspace_id=p_workspace and is_active and deleted_at is null) then raise exception 'Enable a source and a signal rule first';end if;
 if exists(select 1 from public.pipeline_runs where id=p_run and (coalesce((summary->>'model_failures')::integer,0)>0 or coalesce((summary->>'budget_paused')::integer,0)>0)) then raise exception 'Resolve AI failures or budget pauses and run a new test';end if;
 if exists(select 1 from public.pipeline_ai_calls where run_id=p_run and completed_at is null) then raise exception 'Resolve pending AI calls before going live';end if;
 if not exists(select 1 from public.campaign_prospects where workspace_id=p_workspace and group_type='watchlist' and company_id is not null) then raise exception 'Review and save a watch list before going live';end if;
 if not exists(select 1 from public.client_budgets b join public.workspaces w on w.id=b.workspace_id where b.workspace_id=p_workspace and b.status='active' and not b.is_test and (now() at time zone w.timezone)::date between b.period_start and b.period_end-1) then raise exception 'Set an active budget before going live';end if;
 if p_first is null or p_next is null or p_first<=now() or p_first>now()+interval '48 hours' or p_next>p_first or p_next<now() then raise exception 'Invalid first delivery time';end if;
 update public.workspaces set status='live',paused_reason=null,first_morning_at=p_first,next_pipeline_run_at=p_next,latest_pipeline_test_id=p_run where id=p_workspace;
 end;$$;
create function public.go_live_signals(p_workspace uuid,p_run uuid,p_first timestamptz,p_next timestamptz) returns void language sql security invoker set search_path='' as $$select private.go_live_signals(p_workspace,p_run,p_first,p_next);$$;
revoke all on function private.review_signals_test(uuid,uuid),public.review_signals_test(uuid,uuid),private.go_live_signals(uuid,uuid,timestamptz,timestamptz),public.go_live_signals(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function private.review_signals_test(uuid,uuid),public.review_signals_test(uuid,uuid),private.go_live_signals(uuid,uuid,timestamptz,timestamptz),public.go_live_signals(uuid,uuid,timestamptz,timestamptz) to authenticated;
create or replace function private.signals_rule_defaults() returns jsonb language sql immutable set search_path='' as $$select $config$[{"key": "campaign_launch", "label": "Campaign launch", "description": "A brand launches or announces a new campaign.", "polarity": "positive", "enabled": true, "scope": "all"}, {"key": "new_marketing_leader", "label": "New marketing leader", "description": "New CMO, VP Marketing, Brand Director or VP Brand appointed.", "polarity": "positive", "enabled": true, "scope_names": ["Enterprise portfolios", "Established growth brands"]}, {"key": "agency_review", "label": "Agency review or search", "description": "A brand puts creative business up for review, or a consultant announces a search.", "polarity": "neutral", "enabled": true, "scope": "all"}, {"key": "product_launch", "label": "Product launch or expansion", "description": "New product, new market or retail expansion.", "polarity": "positive", "enabled": true, "scope_names": ["Established growth brands", "CPG investors"]}, {"key": "investment", "label": "Investment", "description": "New funding or acquisition of a consumer brand.", "polarity": "positive", "enabled": true, "scope_names": ["CPG investors"]}, {"key": "client_win", "label": "Client win or scope increase", "description": "An agency wins a consumer client or expands scope.", "polarity": "positive", "enabled": true, "scope_names": ["Creative agency partners"]}, {"key": "award", "label": "Award or shortlist", "description": "Shortlisted or won at Cannes, Effies, One Show and similar.", "polarity": "positive", "enabled": true, "scope": "all", "tone_guidance": "No pitch. Acknowledge the award only."}, {"key": "layoffs", "label": "Layoffs or restructure", "description": "Handled gently. Opener is empathetic and never pitches.", "polarity": "negative", "enabled": true, "scope": "all", "tone_guidance": "Only acknowledge the news kindly. No offer, pitch or ask. Score on company/person fit and a fresh confirmed event only."}, {"key": "lost_client", "label": "Lost a major client or account", "description": "Off by default.", "polarity": "negative", "enabled": false, "scope_names": ["Creative agency partners"], "tone_guidance": "Acknowledge sensitively. No pitch."}]$config$::jsonb;$$;
update public.signal_definitions set tone_guidance='Only acknowledge the news kindly. No offer, pitch or ask. Score on company/person fit and a fresh confirmed event only.' where template_key='layoffs' and tone_guidance='Only acknowledge the news kindly. No pitch or opportunity framing. Never raise relevance for layoffs.';

create function private.finalize_signals_card(p_job uuid,p_value jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare j public.pipeline_jobs;run public.pipeline_runs;item public.collection_items;sid uuid;cid uuid;test boolean;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.pipeline_jobs where id=p_job) for update;
 select * into j from public.pipeline_jobs where id=p_job for update;
 if j.id is null or j.stage<>'score' or j.status<>'succeeded' then raise exception 'Successful scoring result required';end if;
 select * into run from public.pipeline_runs where id=j.run_id;
 if run.fingerprint<>private.signals_setup_fingerprint(j.workspace_id) then raise exception 'Setup changed during judging. Run a new test.';end if;
 select * into item from public.collection_items where id=j.item_id and workspace_id=j.workspace_id;
 if (p_value->>'relevance')::integer<7 or (p_value->>'fresh_until')::timestamptz<=now() then return null;end if;
 if not exists(select 1 from public.signal_definitions d join public.campaign_signal_rules cr on cr.signal_definition_id=d.id and cr.workspace_id=j.workspace_id and cr.campaign_id=j.profile_id where d.id=(p_value->>'rule_id')::uuid and d.is_active and d.deleted_at is null and cr.enabled) then raise exception 'Signal rule is disabled for this profile';end if;
 if p_value->>'polarity'='negative' and not exists(select 1 from public.signal_definitions where workspace_id=j.workspace_id and template_key='layoffs' and is_active and deleted_at is null) then return null;end if;
 select kind='test' into test from public.collection_runs where id=j.run_id;
 insert into public.signals(workspace_id,company_id,person_id,signal_definition_id,event_date,event_date_precision,factual_summary,named_entities,event_fingerprint,primary_evidence_item_id,classification_confidence,status)
 values(j.workspace_id,j.company_id,j.person_id,(p_value->>'rule_id')::uuid,((item.item->>'published_at')::timestamptz)::date,'day',p_value->>'event_summary','[]',p_value->>'fingerprint',item.evidence_id,1,'verified') on conflict(workspace_id,event_fingerprint) do update set factual_summary=public.signals.factual_summary returning id into sid;
 insert into public.signal_sources(workspace_id,signal_id,evidence_item_id,is_primary) values(j.workspace_id,sid,item.evidence_id,not exists(select 1 from public.signal_sources where signal_id=sid and is_primary)) on conflict(signal_id,evidence_item_id) do nothing;
 insert into public.signal_sources(workspace_id,signal_id,evidence_item_id,is_primary) select j.workspace_id,sid,alias.evidence_id,false from public.collection_items alias where alias.workspace_id=j.workspace_id and alias.primary_item_id=item.id and alias.evidence_id is not null on conflict(signal_id,evidence_item_id) do nothing;
 insert into public.campaign_signals(workspace_id,campaign_id,signal_id,company_id,person_id,relevance,polarity,pipeline_run_id,is_test,fresh_until,identity_confidence,qualification_state,why_this_person)
 values(j.workspace_id,j.profile_id,sid,j.company_id,j.person_id,(p_value->>'relevance')::integer,p_value->>'polarity',j.run_id,test,(p_value->>'fresh_until')::timestamptz,case when j.person_id is null then 'low' else 'high' end,case when j.person_id is null then 'needs_review' else 'ready' end,p_value->>'reason')
 on conflict(campaign_id,signal_id,pipeline_run_id) where company_id is not null do update set why_this_person=public.campaign_signals.why_this_person returning id into cid;
 insert into public.message_drafts(workspace_id,card_id,channel,subject,body,version,model) values(j.workspace_id,cid,'linkedin',null,p_value->>'opener_linkedin',1,p_value->>'model'),(j.workspace_id,cid,'email',p_value->>'email_subject',p_value->>'email_body',1,p_value->>'model') on conflict(card_id,channel,version) do nothing;
 update public.pipeline_jobs set promoted=true where id=j.id;return cid;end;$$;
create function public.finalize_signals_card(p_job uuid,p_value jsonb) returns uuid language sql security invoker set search_path='' as $$select private.finalize_signals_card(p_job,p_value);$$;
revoke all on function private.finalize_signals_card(uuid,jsonb),public.finalize_signals_card(uuid,jsonb) from public,anon,authenticated;grant execute on function private.finalize_signals_card(uuid,jsonb),public.finalize_signals_card(uuid,jsonb) to service_role;
create or replace function private.start_signals_collection(p_workspace uuid,p_key text,p_snapshot jsonb,p_jobs jsonb,p_kind text default 'manual') returns uuid language plpgsql security definer set search_path='' as $$declare run_id uuid;j jsonb;begin
 if coalesce(auth.jwt()->>'role','')='service_role' and p_kind='scheduled' then perform 1 from public.workspaces where id=p_workspace and is_signals_client and status='live' for update;if not found then raise exception 'Client is not live';end if;else perform private.require_signals_setup_admin(p_workspace);end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and status not in ('paused','archived')) then raise exception 'Client paused';end if;
 if not exists(select 1 from public.campaigns where workspace_id=p_workspace and status<>'archived') then raise exception 'Add an ICP profile before collecting';end if;
 if exists(select 1 from public.search_runs s join public.collection_runs c on c.id=s.id where s.workspace_id=p_workspace and s.status in ('queued','running')) then raise exception 'A collection is already in progress. Open it to continue.';end if;
 if not exists(select 1 from public.client_budgets b join public.workspaces w on w.id=b.workspace_id where b.workspace_id=p_workspace and b.status='active' and not b.is_test and (now() at time zone w.timezone)::date>=b.period_start and (now() at time zone w.timezone)::date<b.period_end) then raise exception 'Budget paused: set an active collection budget';end if;
 if p_kind not in ('manual','test','scheduled') or jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs)>1000 or length(p_key) not between 1 and 160 then raise exception 'Invalid collection plan';end if;
 insert into public.search_runs(workspace_id,run_type,idempotency_key,status,input_scope,requested_by,started_at) values(p_workspace,case when p_kind='scheduled' then 'scheduled' else 'manual' end,'collection:'||p_key,'queued',jsonb_build_object('kind',p_kind,'pipeline','signals_v2'),auth.uid(),now()) returning search_runs.id into run_id;
 insert into public.collection_runs(id,workspace_id,kind,snapshot) values(run_id,p_workspace,p_kind,p_snapshot);
 for j in select value from jsonb_array_elements(p_jobs) loop
 insert into public.source_tasks(workspace_id,run_id,task_key,source_family,provider_key,collection_source_key,input,estimated_cost_usd)
 values(p_workspace,run_id,j->>'key',j->>'family',j->>'provider',j->>'source_key',j,coalesce((j->>'cap_usd')::numeric,0));end loop;
 return run_id;end;$$;

create function private.start_signals_scheduled_collection(p_workspace uuid,p_day date,p_next timestamptz,p_snapshot jsonb,p_jobs jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare id uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where workspaces.id=p_workspace and is_signals_client and status='live' and next_pipeline_run_at<=now() and last_pipeline_local_date is distinct from p_day for update;if not found then return null;end if;
 id:=private.start_signals_collection(p_workspace,'daily:'||p_day::text,p_snapshot,p_jobs,'scheduled');
 update public.workspaces set last_pipeline_local_date=p_day,next_pipeline_run_at=p_next where workspaces.id=p_workspace;return id;end;$$;
create function public.start_signals_scheduled_collection(p_workspace uuid,p_day date,p_next timestamptz,p_snapshot jsonb,p_jobs jsonb) returns uuid language sql security invoker set search_path='' as $$select private.start_signals_scheduled_collection(p_workspace,p_day,p_next,p_snapshot,p_jobs);$$;
revoke all on function private.start_signals_scheduled_collection(uuid,date,timestamptz,jsonb,jsonb),public.start_signals_scheduled_collection(uuid,date,timestamptz,jsonb,jsonb) from public,anon,authenticated;grant execute on function private.start_signals_scheduled_collection(uuid,date,timestamptz,jsonb,jsonb),public.start_signals_scheduled_collection(uuid,date,timestamptz,jsonb,jsonb) to service_role;
create or replace function private.claim_signals_collection_task(p_id uuid,p_fx numeric) returns jsonb language plpgsql security definer set search_path='' as $$declare t public.source_tasks;r uuid;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.source_tasks where id=p_id) and is_signals_client for update;
 if not found then raise exception 'Client unavailable';end if;
 select * into t from public.source_tasks where id=p_id and collection_source_key is not null for update;
 if t.id is null or t.status<>'queued' then return null;end if;
 if p_fx is null or p_fx<=0 then raise exception 'Invalid exchange rate';end if;
 if exists(select 1 from public.workspaces where id=t.workspace_id and status in ('paused','archived')) then
 update public.source_tasks set status='cancelled',started_at=now(),completed_at=now(),error_code=case when (select paused_reason from public.workspaces where id=t.workspace_id) like 'budget:%' then 'budget_paused' else 'client_paused' end,error_summary=case when (select paused_reason from public.workspaces where id=t.workspace_id) like 'budget:%' then 'Budget paused' else 'Client paused or archived' end where id=t.id;return null;end if;
 if t.estimated_cost_usd>0 then
 begin r:=private.reserve_signals_cost(t.workspace_id,'collection:'||t.id::text,ceil(t.estimated_cost_usd*p_fx*1000000)/1000000,coalesce((t.input->>'optional')::boolean,true));
 exception when others then update public.source_tasks set status='cancelled',error_code='budget_paused',error_summary='Budget paused: '||sqlerrm,completed_at=now(),started_at=now() where id=t.id;return null;end;end if;
 update public.source_tasks set status='running',attempt_count=attempt_count+1,started_at=now(),lease_until=now()+interval '5 minutes',reservation_id=r where id=t.id returning * into t;
 update public.search_runs set status='running' where id=t.run_id and status='queued';return to_jsonb(t);end;$$;

commit;
