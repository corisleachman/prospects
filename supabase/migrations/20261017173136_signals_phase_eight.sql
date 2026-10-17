begin;
create function private.signals_card_actor(p_workspace uuid,p_recipient uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins where user_id=p_actor and active) or exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=p_actor and m.status='active' and (m.role='client_admin' or (m.role='client_user' and m.user_id=p_recipient)));
$$;
revoke all on function private.signals_card_actor(uuid,uuid,uuid) from public,anon,authenticated;
create table public.review_actions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),delivery_id uuid not null,actor_id uuid not null references auth.users(id),
 action text not null check(action in ('copied','opened_linkedin','marked_sent','marked_replied','not_relevant','restored','rewrite')),reason text,note text,draft_id uuid,
 created_at timestamptz not null default now(),foreign key(delivery_id,workspace_id) references public.card_deliveries(id,workspace_id),foreign key(draft_id,workspace_id) references public.message_drafts(id,workspace_id)
);
create index review_actions_delivery on public.review_actions(delivery_id,workspace_id);
create index review_actions_actor on public.review_actions(actor_id);
create index review_actions_draft on public.review_actions(draft_id,workspace_id);
create table public.outreach_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),delivery_id uuid not null,actor_id uuid not null references auth.users(id),draft_id uuid not null,
 event text not null check(event in ('sent','replied')),created_at timestamptz not null default now(),
 unique(delivery_id,event),foreign key(delivery_id,workspace_id) references public.card_deliveries(id,workspace_id),foreign key(draft_id,workspace_id) references public.message_drafts(id,workspace_id)
);
create index outreach_event_actor on public.outreach_events(actor_id);
create index outreach_event_draft on public.outreach_events(draft_id,workspace_id);
alter table public.card_deliveries add column sent_draft_id uuid;
alter table public.card_deliveries add foreign key(sent_draft_id,workspace_id) references public.message_drafts(id,workspace_id);
create index delivery_sent_draft on public.card_deliveries(sent_draft_id,workspace_id);
create table public.rewrite_calls(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),delivery_id uuid not null,card_id uuid not null,actor_id uuid not null references auth.users(id),channel text not null check(channel in ('linkedin','email')),
 reservation_id uuid not null,params jsonb not null,rates jsonb not null,fx numeric not null check(fx>0),status text not null default 'reserved' check(status in ('reserved','succeeded','failed')),
 usage jsonb,cost_gbp numeric(14,6),error_summary text,created_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(delivery_id,workspace_id) references public.card_deliveries(id,workspace_id),foreign key(card_id,workspace_id) references public.campaign_signals(id,workspace_id),foreign key(reservation_id,workspace_id) references public.cost_reservations(id,workspace_id)
);
create index rewrite_calls_card on public.rewrite_calls(card_id,workspace_id,channel);
create index rewrite_calls_delivery on public.rewrite_calls(delivery_id,workspace_id);
create index rewrite_calls_actor on public.rewrite_calls(actor_id);
create index rewrite_calls_reservation on public.rewrite_calls(reservation_id,workspace_id);
do $$declare t text;begin foreach t in array array['review_actions','outreach_events','rewrite_calls'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('create policy "platform reads feedback" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);end loop;end $$;
-- Client access is through checked projections, never raw collection/provider payloads.
create function private.signals_cards(p_workspace uuid,p_everyone boolean default false,p_history boolean default false,p_recipient uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare admin boolean:=private.is_platform_admin();client_admin boolean;target uuid:=coalesce(p_recipient,auth.uid());result jsonb;begin
 select exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and status='active' and role='client_admin') into client_admin;
 if not admin and not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and status='active' and role in ('client_admin','client_user')) then raise exception 'Not allowed';end if;
 if p_recipient is not null and p_recipient<>auth.uid() and not admin then raise exception 'Not allowed';end if;
 if p_everyone and not (admin or client_admin) then raise exception 'Not allowed';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and is_signals_client and status<>'archived') then raise exception 'Client unavailable';end if;
 select jsonb_build_object('cards',coalesce(jsonb_agg(x order by x.sensitive,x.position,x.created_at desc),'[]')) into result from (
 select cd.id,cd.card_id,cd.user_id,cd.local_day,cd.position,cd.state,cd.no_repeat_until,cd.sent_at,cd.replied_at,cd.dismissed_at,cd.sent_draft_id,cd.created_at,cs.relevance,cs.polarity,cs.polarity='negative' as sensitive,cs.fresh_until,cs.why_this_person,
 c.id profile_id,c.code profile_code,c.name profile_name,co.name company_name,co.industry,co.location,co.headcount_range,pe.name person_name,pe.title person_title,pe.linkedin_url,m.display_name recipient_name,s.factual_summary,
 (select jsonb_agg(jsonb_build_object('url',e.source_url,'name',e.source_name,'published_at',e.published_at,'primary',ss.is_primary) order by ss.is_primary desc) from public.signal_sources ss join public.evidence_items e on e.id=ss.evidence_item_id and e.workspace_id=ss.workspace_id where ss.signal_id=s.id and ss.workspace_id=p_workspace) sources,
 (select jsonb_agg(jsonb_build_object('id',d.id,'channel',d.channel,'subject',d.subject,'body',d.body,'version',d.version) order by d.version) from public.message_drafts d where d.card_id=cs.id and d.workspace_id=p_workspace) drafts,
 (select jsonb_object_agg(z.channel,z.n) from (select channel,count(*) n from public.rewrite_calls where card_id=cs.id group by channel) z) rewrite_counts,
 (select jsonb_build_object('reason',reason,'note',note) from public.review_actions where delivery_id=cd.id and action='not_relevant' order by created_at desc limit 1) feedback
 from public.card_deliveries cd join public.campaign_signals cs on cs.id=cd.card_id and cs.workspace_id=cd.workspace_id join public.signals s on s.id=cs.signal_id join public.campaigns c on c.id=cs.campaign_id join public.companies co on co.id=cs.company_id left join public.people pe on pe.id=cs.person_id join public.workspace_members m on m.workspace_id=cd.workspace_id and m.user_id=cd.user_id
 join public.workspaces w on w.id=cd.workspace_id
 where cd.workspace_id=p_workspace and not cs.is_test and (p_everyone or cd.user_id=target) and exists(select 1 from public.delivery_rules dr where dr.workspace_id=p_workspace and dr.user_id=cd.user_id and dr.enabled and cs.campaign_id=any(dr.profile_ids))
 and (p_history or (cd.local_day=(now() at time zone w.timezone)::date and cd.state='open' and cs.fresh_until>now()))
 and (p_history or cs.polarity<>'negative' or exists(select 1 from public.signal_definitions sd where sd.workspace_id=p_workspace and sd.template_key='layoffs' and sd.is_active and sd.deleted_at is null))
 )x;
 return result||jsonb_build_object('can_everyone',admin or client_admin,'can_export',admin or client_admin,'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name)),'[]') from public.campaigns c where workspace_id=p_workspace and status<>'archived' and (p_everyone or exists(select 1 from public.delivery_rules d where d.workspace_id=p_workspace and d.user_id=target and d.enabled and c.id=any(d.profile_ids)))),'next_time',(select morning_email_time from public.delivery_rules where workspace_id=p_workspace and user_id=target and enabled),'sent_week',(select count(*) from public.card_deliveries where workspace_id=p_workspace and (p_everyone or user_id=target) and sent_at>=now()-interval '7 days'),'budget_available',exists(select 1 from public.client_budgets b where b.workspace_id=p_workspace and b.status='active' and not b.is_test and b.amount>(select coalesce(sum(l.cost),0) from public.cost_ledger l where l.budget_id=b.id)+(select coalesce(sum(estimated_cost),0) from public.cost_reservations where budget_id=b.id and status='reserved')));
 end;$$;
create function public.signals_cards(p_workspace uuid,p_everyone boolean default false,p_history boolean default false,p_recipient uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.signals_cards(p_workspace,p_everyone,p_history,p_recipient);$$;
revoke all on function private.signals_cards(uuid,boolean,boolean,uuid),public.signals_cards(uuid,boolean,boolean,uuid) from public,anon;grant execute on function private.signals_cards(uuid,boolean,boolean,uuid),public.signals_cards(uuid,boolean,boolean,uuid) to authenticated;
create function private.signals_card_action(p_delivery uuid,p_action text,p_draft uuid default null,p_reason text default null,p_note text default null) returns void language plpgsql security definer set search_path='' as $$declare cd public.card_deliveries;draft public.message_drafts;begin
 select * into cd from public.card_deliveries where id=p_delivery for update;
 if cd.id is null or not private.signals_card_actor(cd.workspace_id,cd.user_id,auth.uid()) then raise exception 'Not allowed';end if;
 if p_action not in ('copied','opened_linkedin','marked_sent','marked_replied','not_relevant','restored') then raise exception 'Invalid action';end if;
 if p_draft is not null then select * into draft from public.message_drafts where id=p_draft and card_id=cd.card_id and workspace_id=cd.workspace_id;if draft.id is null then raise exception 'Draft does not belong to this card';end if;end if;
 if p_action in ('copied','marked_sent') and draft.id is null then raise exception 'Choose the visible opener version';end if;
 if p_action='not_relevant' and p_reason not in ('Wrong person','Wrong company','Old news','Weak reason','Already in touch','Not a real event','Not our market','Other') then raise exception 'Choose a feedback reason';end if;
 if p_action='not_relevant' and p_reason='Other' and trim(coalesce(p_note,''))='' then raise exception 'Add a short note';end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'Note is too long';end if;
 if p_action='marked_sent' and exists(select 1 from public.campaign_signals where id=cd.card_id and person_id is null) then raise exception 'Find a person before marking this card sent';end if;
 if p_action='marked_sent' and cd.state<>'open' then raise exception 'Card is already handled';end if;
 if p_action='marked_replied' and cd.state<>'sent' then raise exception 'Mark sent before recording a reply';end if;
 if p_action='restored' and exists(select 1 from public.campaign_signals where id=cd.card_id and fresh_until<=now()) then raise exception 'This source is outside its freshness window';end if;
 if p_action='restored' and cd.state<>'dismissed' then raise exception 'Only dismissed cards can be restored';end if;
 if p_action='marked_sent' then update public.card_deliveries set state='sent',sent_at=now(),sent_draft_id=p_draft where id=cd.id;insert into public.outreach_events(workspace_id,delivery_id,actor_id,draft_id,event) values(cd.workspace_id,cd.id,auth.uid(),p_draft,'sent') on conflict(delivery_id,event) do nothing;
 elsif p_action='marked_replied' then update public.card_deliveries set state='replied',replied_at=now() where id=cd.id;insert into public.outreach_events(workspace_id,delivery_id,actor_id,draft_id,event) values(cd.workspace_id,cd.id,auth.uid(),cd.sent_draft_id,'replied') on conflict(delivery_id,event) do nothing;
 elsif p_action='not_relevant' then update public.card_deliveries set state='dismissed',dismissed_at=now() where id=cd.id;
 elsif p_action='restored' then update public.card_deliveries set state='open',dismissed_at=null where id=cd.id;end if;
 insert into public.review_actions(workspace_id,delivery_id,actor_id,action,reason,note,draft_id) values(cd.workspace_id,cd.id,auth.uid(),p_action,p_reason,p_note,p_draft);
 end;$$;
create function public.signals_card_action(p_delivery uuid,p_action text,p_draft uuid default null,p_reason text default null,p_note text default null) returns void language sql security invoker set search_path='' as $$select private.signals_card_action(p_delivery,p_action,p_draft,p_reason,p_note);$$;
revoke all on function private.signals_card_action(uuid,text,uuid,text,text),public.signals_card_action(uuid,text,uuid,text,text) from public,anon;grant execute on function private.signals_card_action(uuid,text,uuid,text,text),public.signals_card_action(uuid,text,uuid,text,text) to authenticated;
create function private.signals_rewrite_context(p_delivery uuid,p_actor uuid,p_channel text) returns jsonb language plpgsql security definer set search_path='' as $$declare cd public.card_deliveries;cs public.campaign_signals;result jsonb;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 select * into cd from public.card_deliveries where id=p_delivery;
 if cd.id is null or not private.signals_card_actor(cd.workspace_id,cd.user_id,p_actor) then raise exception 'Not allowed';end if;
 select * into cs from public.campaign_signals where id=cd.card_id;
 if cd.state<>'open' or cs.fresh_until<=now() then raise exception 'Card is no longer current';end if;
 if p_channel not in ('linkedin','email') then raise exception 'Choose an opener tab';end if;
 return jsonb_build_object('workspace_id',cd.workspace_id,'card_id',cs.id,'profile_id',cs.campaign_id,'setup',private.signals_pipeline_setup(cd.workspace_id),'item',(select ci.item from public.pipeline_jobs j join public.collection_items ci on ci.id=j.item_id where j.run_id=cs.pipeline_run_id and j.profile_id=cs.campaign_id and j.stage='score' and j.promoted and j.company_id=cs.company_id and j.item_id in (select ci2.id from public.collection_items ci2 join public.signals s2 on s2.primary_evidence_item_id=ci2.evidence_id where s2.id=cs.signal_id and ci2.workspace_id=cs.workspace_id) order by j.created_at limit 1),'judgment',(select j.result from public.pipeline_jobs j where j.run_id=cs.pipeline_run_id and j.profile_id=cs.campaign_id and j.stage='score' and j.promoted and j.company_id=cs.company_id and j.item_id in (select ci2.id from public.collection_items ci2 join public.signals s2 on s2.primary_evidence_item_id=ci2.evidence_id where s2.id=cs.signal_id and ci2.workspace_id=cs.workspace_id) order by j.created_at limit 1),'person',(select jsonb_build_object('name',name,'title',title) from public.people where id=cs.person_id),'polarity',cs.polarity,'current',(select jsonb_build_object('subject',subject,'body',body) from public.message_drafts where card_id=cs.id and channel=p_channel order by version desc limit 1));
 end;$$;
create function public.signals_rewrite_context(p_delivery uuid,p_actor uuid,p_channel text) returns jsonb language sql security invoker set search_path='' as $$select private.signals_rewrite_context(p_delivery,p_actor,p_channel);$$;
create function private.reserve_signals_rewrite(p_delivery uuid,p_actor uuid,p_channel text,p_call uuid,p_cap numeric,p_params jsonb,p_rates jsonb,p_fx numeric) returns uuid language plpgsql security definer set search_path='' as $$declare context jsonb;reservation uuid;begin
 context:=private.signals_rewrite_context(p_delivery,p_actor,p_channel);
 perform 1 from public.workspaces where id=(context->>'workspace_id')::uuid for update;
 perform 1 from public.campaign_signals where id=(context->>'card_id')::uuid for update;
 if (select max(version) from public.message_drafts where card_id=(context->>'card_id')::uuid and channel=p_channel)>=4 or (select count(*) from public.rewrite_calls where card_id=(context->>'card_id')::uuid and channel=p_channel)>=3 then raise exception 'Three rewrites used for this tab';end if;
 if exists(select 1 from public.rewrite_calls where card_id=(context->>'card_id')::uuid and channel=p_channel and completed_at is null) then raise exception 'A rewrite is already running';end if;
 reservation:=private.reserve_signals_cost((context->>'workspace_id')::uuid,'rewrite:'||p_call::text,p_cap,false);
 insert into public.rewrite_calls(id,workspace_id,delivery_id,card_id,actor_id,channel,reservation_id,params,rates,fx) values(p_call,(context->>'workspace_id')::uuid,p_delivery,(context->>'card_id')::uuid,p_actor,p_channel,reservation,p_params,p_rates,p_fx);
 return p_call;end;$$;
create function public.reserve_signals_rewrite(p_delivery uuid,p_actor uuid,p_channel text,p_call uuid,p_cap numeric,p_params jsonb,p_rates jsonb,p_fx numeric) returns uuid language sql security invoker set search_path='' as $$select private.reserve_signals_rewrite(p_delivery,p_actor,p_channel,p_call,p_cap,p_params,p_rates,p_fx);$$;
create function private.settle_signals_rewrite(p_call uuid,p_cost numeric,p_usage jsonb,p_value jsonb,p_error text,p_stop text) returns uuid language plpgsql security definer set search_path='' as $$declare c public.rewrite_calls;draft uuid;v integer;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 select * into c from public.rewrite_calls where id=p_call for update;if c.id is null then raise exception 'Rewrite unavailable';end if;if c.completed_at is not null then return null;end if;
 perform private.settle_signals_cost(c.reservation_id,p_cost,jsonb_build_object('stage','rewrite','provider','anthropic','source_key','rewrite','model',c.params->>'model','units',coalesce(p_usage,'{}')||jsonb_build_object('call_id',c.id,'stop_reason',p_stop),'cost_basis',case when p_usage is null then 'estimated' else 'reported' end,'outcome',case when p_error is null then 'success' else 'failed' end,'batch',false,'cached',coalesce((p_usage->>'cache_read_input_tokens')::integer,0)>0));
 if p_error is null then
 perform 1 from public.campaign_signals where id=c.card_id for update;
 select coalesce(max(version),0)+1 into v from public.message_drafts where card_id=c.card_id and channel=c.channel;
 insert into public.message_drafts(workspace_id,card_id,channel,subject,body,version,model,created_by) values(c.workspace_id,c.card_id,c.channel,p_value->>'subject',p_value->>'body',v,c.params->>'model',c.actor_id) returning id into draft;
 insert into public.review_actions(workspace_id,delivery_id,actor_id,action,draft_id) values(c.workspace_id,c.delivery_id,c.actor_id,'rewrite',draft);
 end if;
 update public.rewrite_calls set status=case when p_error is null then 'succeeded' else 'failed' end,cost_gbp=p_cost,usage=p_usage,error_summary=p_error,completed_at=now() where id=c.id;return draft;end;$$;
create function public.settle_signals_rewrite(p_call uuid,p_cost numeric,p_usage jsonb,p_value jsonb,p_error text,p_stop text) returns uuid language sql security invoker set search_path='' as $$select private.settle_signals_rewrite(p_call,p_cost,p_usage,p_value,p_error,p_stop);$$;
revoke all on function private.signals_rewrite_context(uuid,uuid,text),public.signals_rewrite_context(uuid,uuid,text),private.reserve_signals_rewrite(uuid,uuid,text,uuid,numeric,jsonb,jsonb,numeric),public.reserve_signals_rewrite(uuid,uuid,text,uuid,numeric,jsonb,jsonb,numeric),private.settle_signals_rewrite(uuid,numeric,jsonb,jsonb,text,text),public.settle_signals_rewrite(uuid,numeric,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.signals_rewrite_context(uuid,uuid,text),public.signals_rewrite_context(uuid,uuid,text),private.reserve_signals_rewrite(uuid,uuid,text,uuid,numeric,jsonb,jsonb,numeric),public.reserve_signals_rewrite(uuid,uuid,text,uuid,numeric,jsonb,jsonb,numeric),private.settle_signals_rewrite(uuid,numeric,jsonb,jsonb,text,text),public.settle_signals_rewrite(uuid,numeric,jsonb,jsonb,text,text) to service_role;

create table public.person_lookup_calls(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),delivery_id uuid not null,actor_id uuid not null references auth.users(id),reservation_id uuid not null,
 cap_gbp numeric not null,usage jsonb,error_summary text,completed_at timestamptz,created_at timestamptz not null default now(),
 foreign key(delivery_id,workspace_id) references public.card_deliveries(id,workspace_id),foreign key(reservation_id,workspace_id) references public.cost_reservations(id,workspace_id)
);
create index person_lookup_workspace on public.person_lookup_calls(workspace_id,delivery_id);
create index person_lookup_actor on public.person_lookup_calls(actor_id);
create index person_lookup_reservation on public.person_lookup_calls(reservation_id,workspace_id);
alter table public.person_lookup_calls enable row level security;revoke all on public.person_lookup_calls from public,anon,authenticated;grant all on public.person_lookup_calls to service_role;
create function private.signals_person_context(p_delivery uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare cd public.card_deliveries;cs public.campaign_signals;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 select * into cd from public.card_deliveries where id=p_delivery;
 if cd.id is null or not private.signals_card_actor(cd.workspace_id,cd.user_id,p_actor) then raise exception 'Not allowed';end if;
 select * into cs from public.campaign_signals where id=cd.card_id;
 if cd.state<>'open' or cs.fresh_until<=now() or cs.person_id is not null then raise exception 'Card is no longer waiting for a person';end if;
 return jsonb_build_object('workspace_id',cd.workspace_id,'card_id',cs.id,'company',(select to_jsonb(c) from public.companies c where id=cs.company_id),'profile',(select to_jsonb(c) from public.campaigns c where id=cs.campaign_id),'people',(select coalesce(jsonb_agg(jsonb_build_object('id',pe.id,'name',pe.name,'title',pe.title,'linkedin_url',pe.linkedin_url,'company_id',pe.company_id)),'[]') from public.people pe where company_id=cs.company_id and exists(select 1 from public.campaign_prospects cp where cp.workspace_id=cd.workspace_id and cp.campaign_id=cs.campaign_id and cp.person_id=pe.id and cp.group_type='watchlist')));
 end;$$;
create function public.signals_person_context(p_delivery uuid,p_actor uuid) returns jsonb language sql security invoker set search_path='' as $$select private.signals_person_context(p_delivery,p_actor);$$;
create function private.begin_signals_person_lookup(p_delivery uuid,p_actor uuid,p_call uuid,p_cap numeric) returns uuid language plpgsql security definer set search_path='' as $$declare context jsonb;r uuid;begin
 context:=private.signals_person_context(p_delivery,p_actor);perform 1 from public.workspaces where id=(context->>'workspace_id')::uuid for update;
 if exists(select 1 from public.person_lookup_calls where delivery_id=p_delivery and completed_at is null) then raise exception 'Person search is already running';end if;
 if (select count(*) from public.person_lookup_calls where delivery_id=p_delivery)>=3 then raise exception 'Three person searches used for this card';end if;
 r:=private.reserve_signals_cost((context->>'workspace_id')::uuid,'person:'||p_call::text,p_cap,false);
 insert into public.person_lookup_calls(id,workspace_id,delivery_id,actor_id,reservation_id,cap_gbp) values(p_call,(context->>'workspace_id')::uuid,p_delivery,p_actor,r,p_cap);return p_call;end;$$;
create function public.begin_signals_person_lookup(p_delivery uuid,p_actor uuid,p_call uuid,p_cap numeric) returns uuid language sql security invoker set search_path='' as $$select private.begin_signals_person_lookup(p_delivery,p_actor,p_call,p_cap);$$;
create function private.finish_signals_person_lookup(p_delivery uuid,p_actor uuid,p_person uuid,p_call uuid default null,p_cost numeric default 0,p_usage jsonb default '{}',p_error text default null) returns void language plpgsql security definer set search_path='' as $$declare cd public.card_deliveries;c public.person_lookup_calls;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Not allowed';end if;
 perform 1 from public.workspaces where id=(select workspace_id from public.card_deliveries where id=p_delivery) for update;
 select * into cd from public.card_deliveries where id=p_delivery for update;
 if cd.id is null or (p_call is null and not private.signals_card_actor(cd.workspace_id,cd.user_id,p_actor)) then raise exception 'Not allowed';end if;
 if p_call is not null then
 select * into c from public.person_lookup_calls where id=p_call and delivery_id=cd.id and actor_id=p_actor for update;if c.id is null then raise exception 'Search unavailable';end if;if c.completed_at is not null then return;end if;
 perform private.settle_signals_cost(c.reservation_id,p_cost,jsonb_build_object('stage','find_person','provider','treg','source_key','person_search','units',coalesce(p_usage,'{}'::jsonb),'cost_basis',case when p_usage is null then 'estimated' else 'reported' end,'outcome',case when p_error is null then 'success' else 'failed' end));
 update public.person_lookup_calls set completed_at=now(),usage=p_usage,error_summary=p_error where id=c.id;
 end if;
 if p_person is not null and p_error is null and private.signals_card_actor(cd.workspace_id,cd.user_id,p_actor) then
 update public.campaign_signals cs set person_id=p_person,identity_confidence='high',qualification_state='ready' where cs.id=cd.card_id and cs.person_id is null and exists(select 1 from public.people pe where pe.id=p_person and pe.company_id=cs.company_id);
 end if;
 end;$$;
create function public.finish_signals_person_lookup(p_delivery uuid,p_actor uuid,p_person uuid,p_call uuid default null,p_cost numeric default 0,p_usage jsonb default '{}',p_error text default null) returns void language sql security invoker set search_path='' as $$select private.finish_signals_person_lookup(p_delivery,p_actor,p_person,p_call,p_cost,p_usage,p_error);$$;
revoke all on function private.signals_person_context(uuid,uuid),public.signals_person_context(uuid,uuid),private.begin_signals_person_lookup(uuid,uuid,uuid,numeric),public.begin_signals_person_lookup(uuid,uuid,uuid,numeric),private.finish_signals_person_lookup(uuid,uuid,uuid,uuid,numeric,jsonb,text),public.finish_signals_person_lookup(uuid,uuid,uuid,uuid,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function private.signals_person_context(uuid,uuid),public.signals_person_context(uuid,uuid),private.begin_signals_person_lookup(uuid,uuid,uuid,numeric),public.begin_signals_person_lookup(uuid,uuid,uuid,numeric),private.finish_signals_person_lookup(uuid,uuid,uuid,uuid,numeric,jsonb,text),public.finish_signals_person_lookup(uuid,uuid,uuid,uuid,numeric,jsonb,text) to service_role;

commit;
