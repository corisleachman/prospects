begin;
-- Keep legacy polarity values intact. Signals V2 uses positive/negative/neutral.
alter table public.signal_definitions drop constraint signal_definitions_polarity_check;
alter table public.signal_definitions add constraint signal_definitions_polarity_check check(polarity is null or polarity in ('opportunity','pressure','intent','perspective','positive','negative','neutral'));
alter table public.signal_definitions add column tone_guidance text not null default '';
alter table public.signal_definitions add column keywords jsonb not null default '[]' check(jsonb_typeof(keywords)='array');
alter table public.signal_definitions add column applies_to_all boolean not null default true;
alter table public.signal_definitions add column template_key text;
alter table public.signal_definitions add column scope_names jsonb not null default '[]';
alter table public.signal_definitions add column scope_customized boolean not null default false;
alter table public.signal_definitions add column setup_revision integer not null default 0;
alter table public.signal_definitions add column deleted_at timestamptz;
alter table public.campaign_source_rules add column source_key text;
alter table public.campaign_source_rules add column freshness_hours integer not null default 48 check(freshness_hours in (24,48,72,168,336));
alter table public.campaign_source_rules add column extra_feeds jsonb not null default '[]';
alter table public.workspaces add column signals_setup_seeded boolean not null default false;
alter table public.workspace_invites add column display_name text not null default '' check(length(display_name)<=120);
alter table public.workspace_invites add constraint workspace_invites_id_workspace_unique unique(id,workspace_id);
create table public.workspace_source_settings(
 workspace_id uuid not null references public.workspaces(id),source_key text not null,
 enabled boolean not null default true,freshness_hours integer not null default 48 check(freshness_hours in (24,48,72,168,336)),
 config jsonb not null,setup_revision integer not null default 0,primary key(workspace_id,source_key)
);
create table public.client_extra_sources(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),url text not null check(length(url)<=2000 and url ~ '^https://'),
 validation_status text not null default 'pending' check(validation_status in ('pending','ok','no_dates','failed')),detected_feed text,checked_at timestamptz,last_error text,
 setup_revision integer not null default 0,deleted_at timestamptz,created_at timestamptz not null default now(),unique(workspace_id,url)
);
create table public.voice_profiles(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),user_id uuid references auth.users(id),
 examples_text text not null default '' check(length(examples_text)<=40000),tone text not null default '',sign_off text not null default '',
 banned_phrases text[] not null default '{}',channels text[] not null default '{email,linkedin}' check(channels<@array['email','linkedin']::text[]),
 linkedin_length integer not null default 280 check(linkedin_length in (200,280)),setup_revision integer not null default 0,updated_at timestamptz not null default now()
);
create unique index voice_workspace_default on public.voice_profiles(workspace_id) where user_id is null;
create index voice_workspace_idx on public.voice_profiles(workspace_id);
create index voice_user_idx on public.voice_profiles(user_id);
create table public.delivery_rules(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),user_id uuid,invite_id uuid,
 profile_ids uuid[] not null default '{}',max_cards_per_day integer not null default 10 check(max_cards_per_day between 1 and 100),
 no_repeat_days integer not null default 30 check(no_repeat_days between 1 and 365),morning_email_time time,
 enabled boolean not null default true,setup_revision integer not null default 0,
 check(user_id is not null or invite_id is not null),check(morning_email_time is null or morning_email_time in ('07:00','07:30','08:00','08:30')),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(invite_id,workspace_id) references public.workspace_invites(id,workspace_id),unique(id,workspace_id)
);
create unique index delivery_user_unique on public.delivery_rules(workspace_id,user_id) where user_id is not null;
create unique index delivery_invite_unique on public.delivery_rules(invite_id) where invite_id is not null;
create index delivery_workspace_idx on public.delivery_rules(workspace_id);
create index delivery_user_idx on public.delivery_rules(user_id);
create index extra_workspace_idx on public.client_extra_sources(workspace_id);
create function private.validate_delivery_profiles() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from unnest(new.profile_ids) x where not exists(select 1 from public.campaigns c where c.id=x and c.workspace_id=new.workspace_id and c.status<>'archived')) then raise exception 'Profiles must belong to this client';end if;return new;end;$$;
revoke all on function private.validate_delivery_profiles() from public,anon,authenticated;
create trigger validate_delivery_profiles before insert or update on public.delivery_rules for each row execute function private.validate_delivery_profiles();
do $$declare t text;begin foreach t in array array['workspace_source_settings','client_extra_sources','voice_profiles','delivery_rules'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "platform reads setup" on public.%I for select to authenticated using ((select private.is_platform_admin()))',t);
 end loop;end $$;
create policy "own delivery route" on public.delivery_rules for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=delivery_rules.workspace_id and m.user_id=(select auth.uid()) and m.status='active'));
create function private.require_signals_setup_admin(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_platform_admin() then raise exception 'Not allowed' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace and is_signals_client and status<>'archived' for update;
 if not found then raise exception 'Client unavailable';end if;end;$$;
revoke all on function private.require_signals_setup_admin(uuid) from public,anon,authenticated;
create function private.signals_rule_defaults() returns jsonb language sql immutable set search_path='' as $$select $config$[{"key": "campaign_launch", "label": "Campaign launch", "description": "A brand launches or announces a new campaign.", "polarity": "positive", "enabled": true, "scope": "all"}, {"key": "new_marketing_leader", "label": "New marketing leader", "description": "New CMO, VP Marketing, Brand Director or VP Brand appointed.", "polarity": "positive", "enabled": true, "scope_names": ["Enterprise portfolios", "Established growth brands"]}, {"key": "agency_review", "label": "Agency review or search", "description": "A brand puts creative business up for review, or a consultant announces a search.", "polarity": "neutral", "enabled": true, "scope": "all"}, {"key": "product_launch", "label": "Product launch or expansion", "description": "New product, new market or retail expansion.", "polarity": "positive", "enabled": true, "scope_names": ["Established growth brands", "CPG investors"]}, {"key": "investment", "label": "Investment", "description": "New funding or acquisition of a consumer brand.", "polarity": "positive", "enabled": true, "scope_names": ["CPG investors"]}, {"key": "client_win", "label": "Client win or scope increase", "description": "An agency wins a consumer client or expands scope.", "polarity": "positive", "enabled": true, "scope_names": ["Creative agency partners"]}, {"key": "award", "label": "Award or shortlist", "description": "Shortlisted or won at Cannes, Effies, One Show and similar.", "polarity": "positive", "enabled": true, "scope": "all", "tone_guidance": "No pitch. Acknowledge the award only."}, {"key": "layoffs", "label": "Layoffs or restructure", "description": "Handled gently. Opener is empathetic and never pitches.", "polarity": "negative", "enabled": true, "scope": "all", "tone_guidance": "Only acknowledge the news kindly. No pitch or opportunity framing. Never raise relevance for layoffs."}, {"key": "lost_client", "label": "Lost a major client or account", "description": "Off by default.", "polarity": "negative", "enabled": false, "scope_names": ["Creative agency partners"], "tone_guidance": "Acknowledge sensitively. No pitch."}]$config$::jsonb;$$;
create function private.signals_source_catalog() returns jsonb language sql immutable set search_path='' as $$select $config$[{"key": "trade_press", "name": "Trade press", "description": "Adweek, Marketing Dive and Muse by Clio. The three working trade feeds from the sourcing test.", "family": "publication", "provider": "public_rss_trade", "enabled": true, "freshness_hours": 48, "adapter": "rss", "feeds": ["https://www.adweek.com/feed/", "https://www.marketingdive.com/feeds/news/", "https://musebyclios.com/feed/"]}, {"key": "news_search", "name": "News search", "description": "Watched brands by name and event phrases across the market. AnyAPI Google News through treg.", "family": "web_search", "provider": "treg_anyapi_news", "enabled": true, "freshness_hours": 48, "adapter": "treg_news", "endpoint": "anyapi.google.serp.news"}, {"key": "press_wires", "name": "Press release wires", "description": "PR Newswire and Business Wire consumer feeds. English only; financial notices are filtered out.", "family": "publication", "provider": "public_rss_wires", "enabled": true, "freshness_hours": 48, "adapter": "rss", "feeds": ["https://www.prnewswire.com/rss/consumer-products-retail-latest-news/consumer-products-retail-latest-news-list.rss", "https://www.prnewswire.com/rss/food-beverages-latest-news/food-beverages-latest-news-list.rss", "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpQWA=="]}, {"key": "linkedin_posts", "name": "LinkedIn posts", "description": "Posts from watched people only. Collection currently excludes reactions and comments, matching the sourcing test.", "family": "linkedin", "provider": "apify_harvestapi", "enabled": true, "freshness_hours": 48, "adapter": "apify_posts", "actor": "harvestapi~linkedin-profile-posts"}]$config$::jsonb;$$;
revoke all on function private.signals_rule_defaults(),private.signals_source_catalog() from public,anon,authenticated;
create function private.seed_signals_setup(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$declare v jsonb;rid uuid;begin
 perform 1 from public.workspaces where id=p_workspace and is_signals_client and not signals_setup_seeded for update;
 if not found then return;end if;
 for v in select value from jsonb_array_elements(private.signals_rule_defaults()) loop
 insert into public.signal_definitions(workspace_id,key,label,description,polarity,tone_guidance,is_active,applies_to_all,template_key,scope_names)
 values(p_workspace,'signals_v2_'||(v->>'key'),v->>'label',v->>'description',v->>'polarity',coalesce(v->>'tone_guidance',''),(v->>'enabled')::boolean,coalesce(v->>'scope','')='all',v->>'key',coalesce(v->'scope_names','[]')) returning id into rid;
 insert into public.campaign_signal_rules(workspace_id,campaign_id,signal_definition_id,enabled)
 select p_workspace,c.id,rid,(v->>'enabled')::boolean from public.campaigns c where c.workspace_id=p_workspace and c.status<>'archived' and (v->>'scope'='all' or exists(select 1 from jsonb_array_elements_text(coalesce(v->'scope_names','[]')) n where lower(n)=lower(c.name)));
 end loop;
 for v in select value from jsonb_array_elements(private.signals_source_catalog()) loop
 insert into public.workspace_source_settings(workspace_id,source_key,enabled,freshness_hours,config) values(p_workspace,v->>'key',(v->>'enabled')::boolean,(v->>'freshness_hours')::integer,v);
 insert into public.campaign_source_rules(workspace_id,campaign_id,source_key,source_family,provider_key,enabled,freshness_hours,include_rules)
 select p_workspace,c.id,v->>'key',v->>'family',v->>'provider',(v->>'enabled')::boolean,(v->>'freshness_hours')::integer,v from public.campaigns c where c.workspace_id=p_workspace and c.status<>'archived';
 end loop;
 insert into public.voice_profiles(workspace_id) values(p_workspace);
 insert into public.delivery_rules(workspace_id,user_id) select p_workspace,user_id from public.workspace_members where workspace_id=p_workspace and status='active' on conflict do nothing;
 insert into public.delivery_rules(workspace_id,invite_id) select p_workspace,id from public.workspace_invites where workspace_id=p_workspace and accepted_at is null and revoked_at is null and expires_at>now() on conflict do nothing;
 update public.workspaces set signals_setup_seeded=true where id=p_workspace;
 end;$$;
revoke all on function private.seed_signals_setup(uuid) from public,anon,authenticated;
create function private.seed_signals_workspace_trigger() returns trigger language plpgsql security definer set search_path='' as $$begin if new.is_signals_client then perform private.seed_signals_setup(new.id);end if;return new;end;$$;
revoke all on function private.seed_signals_workspace_trigger() from public,anon,authenticated;
create trigger seed_signals_workspace after insert on public.workspaces for each row execute function private.seed_signals_workspace_trigger();
create function private.inherit_signals_profile_setup() returns trigger language plpgsql security definer set search_path='' as $$declare r public.signal_definitions;s public.workspace_source_settings;begin
 if not exists(select 1 from public.workspaces where id=new.workspace_id and is_signals_client) then return new;end if;
 for r in select * from public.signal_definitions where workspace_id=new.workspace_id and deleted_at is null loop
 if r.applies_to_all or (not r.scope_customized and exists(select 1 from jsonb_array_elements_text(r.scope_names) n where lower(n)=lower(new.name))) then
 insert into public.campaign_signal_rules(workspace_id,campaign_id,signal_definition_id,enabled) values(new.workspace_id,new.id,r.id,r.is_active) on conflict(campaign_id,signal_definition_id) do nothing;end if;end loop;
 for s in select * from public.workspace_source_settings where workspace_id=new.workspace_id loop
 insert into public.campaign_source_rules(workspace_id,campaign_id,source_key,source_family,provider_key,enabled,freshness_hours,include_rules) values(new.workspace_id,new.id,s.source_key,s.config->>'family',s.config->>'provider',s.enabled,s.freshness_hours,s.config)
 on conflict do nothing;end loop;return new;end;$$;
revoke all on function private.inherit_signals_profile_setup() from public,anon,authenticated;
create trigger inherit_signals_profile_setup after insert or update of name on public.campaigns for each row execute function private.inherit_signals_profile_setup();
create function private.bind_signals_invite_delivery() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.workspaces where id=new.workspace_id and is_signals_client) then return new;end if;
 if tg_op='INSERT' then insert into public.delivery_rules(workspace_id,invite_id) values(new.workspace_id,new.id);return new;end if;
 if new.accepted_at is not null and old.accepted_at is null then
 if exists(select 1 from public.delivery_rules where workspace_id=new.workspace_id and user_id=new.accepted_by) then update public.delivery_rules set enabled=false where invite_id=new.id;
 else update public.delivery_rules set user_id=new.accepted_by where invite_id=new.id;end if;
 update public.workspace_members set display_name=new.display_name where workspace_id=new.workspace_id and user_id=new.accepted_by and display_name='' and new.display_name<>'';
 end if;return new;end;$$;
revoke all on function private.bind_signals_invite_delivery() from public,anon,authenticated;
create trigger bind_signals_invite_delivery after insert or update of accepted_at on public.workspace_invites for each row execute function private.bind_signals_invite_delivery();
select private.seed_signals_setup(id) from public.workspaces where is_signals_client;
create function private.save_signals_rule(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 declare r public.signal_definitions;ids uuid[];is_all boolean;custom_scope boolean;begin
 perform private.require_signals_setup_admin(p_workspace);
 if length(trim(coalesce(p_value->>'label',''))) not between 1 and 160 or length(coalesce(p_value->>'description',''))>2000 then raise exception 'Enter a name and a short description';end if;
 if p_value->>'polarity' not in ('positive','negative','neutral') or p_value->>'polarity' is null then raise exception 'Choose a signal type';end if;
 if jsonb_typeof(p_value->'keywords')<>'array' or jsonb_array_length(p_value->'keywords')>100 or p_value->'keywords' is null then raise exception 'Use up to 100 keyword chips';end if;
 if exists(select 1 from jsonb_array_elements(p_value->'keywords') v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>200) then raise exception 'Keywords must be short text';end if;
 ids:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_value->'profile_ids','[]')));
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.campaigns where id=x and workspace_id=p_workspace and status<>'archived')) then raise exception 'Profiles must belong to this client';end if;
 is_all:=coalesce((p_value->>'applies_to_all')::boolean,true);
 if p_id is null then
 insert into public.signal_definitions(workspace_id,key,label,polarity) values(p_workspace,'custom_'||replace(gen_random_uuid()::text,'-',''),trim(p_value->>'label'),p_value->>'polarity') returning * into r;
 else select * into r from public.signal_definitions where id=p_id and workspace_id=p_workspace and deleted_at is null for update;
 if r.id is null or r.setup_revision<>p_revision then raise exception 'Rule changed elsewhere. Reload before saving.' using errcode='40001';end if;end if;
 custom_scope:=r.scope_customized or is_all<>r.applies_to_all or (not is_all and (select array_agg(x order by x) from unnest(ids) x) is distinct from (select array_agg(campaign_id order by campaign_id) from public.campaign_signal_rules where signal_definition_id=r.id and enabled));
 update public.signal_definitions set label=trim(p_value->>'label'),description=coalesce(p_value->>'description',''),polarity=p_value->>'polarity',tone_guidance=coalesce(p_value->>'tone_guidance',''),keywords=p_value->'keywords',is_active=coalesce((p_value->>'is_active')::boolean,true),applies_to_all=is_all,scope_customized=custom_scope,setup_revision=setup_revision+1 where id=r.id returning * into r;
 delete from public.campaign_signal_rules where signal_definition_id=r.id and workspace_id=p_workspace;
 insert into public.campaign_signal_rules(workspace_id,campaign_id,signal_definition_id,enabled) select p_workspace,c.id,r.id,r.is_active from public.campaigns c where c.workspace_id=p_workspace and c.status<>'archived' and (is_all or c.id=any(ids));
 return to_jsonb(r)||jsonb_build_object('profile_ids',case when is_all then (select coalesce(jsonb_agg(id),'[]') from public.campaigns where workspace_id=p_workspace and status<>'archived') else to_jsonb(ids) end);end;$$;
create function private.delete_signals_rule(p_workspace uuid,p_id uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_signals_setup_admin(p_workspace);
 update public.signal_definitions set deleted_at=now(),is_active=false,setup_revision=setup_revision+1 where id=p_id and workspace_id=p_workspace and setup_revision=p_revision and deleted_at is null;
 if not found then raise exception 'Rule changed elsewhere. Reload before deleting.';end if;
 update public.campaign_signal_rules set enabled=false where signal_definition_id=p_id and workspace_id=p_workspace;end;$$;
create function private.save_signals_source(p_workspace uuid,p_key text,p_revision integer,p_enabled boolean,p_hours integer) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.workspace_source_settings;begin
 perform private.require_signals_setup_admin(p_workspace);
 update public.workspace_source_settings set enabled=p_enabled,freshness_hours=p_hours,setup_revision=setup_revision+1 where workspace_id=p_workspace and source_key=p_key and setup_revision=p_revision returning * into r;
 if not found then raise exception 'Source changed elsewhere. Reload before saving.' using errcode='40001';end if;
 update public.campaign_source_rules set enabled=p_enabled,freshness_hours=p_hours where workspace_id=p_workspace and source_key=p_key;
 return to_jsonb(r);end;$$;
create function private.save_signals_voice(p_workspace uuid,p_revision integer,p_value jsonb) returns integer language plpgsql security definer set search_path='' as $$declare v integer;begin
 perform private.require_signals_setup_admin(p_workspace);
 if length(coalesce(p_value->>'sign_off',''))>200 or length(coalesce(p_value->>'tone',''))>1000 then raise exception 'Shorten the sign-off or tone';end if;
 update public.voice_profiles set examples_text=coalesce(p_value->>'examples_text',''),tone=coalesce(p_value->>'tone',''),sign_off=coalesce(p_value->>'sign_off',''),banned_phrases=array(select jsonb_array_elements_text(coalesce(p_value->'banned_phrases','[]'))),channels=array(select jsonb_array_elements_text(coalesce(p_value->'channels','[]'))),linkedin_length=coalesce((p_value->>'linkedin_length')::integer,280),setup_revision=setup_revision+1,updated_at=now() where workspace_id=p_workspace and user_id is null and setup_revision=p_revision returning setup_revision into v;
 if not found then raise exception 'Voice changed elsewhere. Reload before saving.' using errcode='40001';end if;return v;end;$$;
create function private.save_signals_delivery(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.delivery_rules;vrole text;begin
 perform private.require_signals_setup_admin(p_workspace);
 select * into r from public.delivery_rules where workspace_id=p_workspace and id=p_id for update;
 if r.id is null or r.setup_revision<>p_revision then raise exception 'Person changed elsewhere. Reload before saving.' using errcode='40001';end if;
 vrole:=p_value->>'role';if vrole not in ('client_admin','client_user') or vrole is null then raise exception 'Choose a client role';end if;
 if length(coalesce(p_value->>'display_name',''))>120 then raise exception 'Name is too long';end if;
 if r.user_id is not null then
 update public.workspace_members set display_name=coalesce(p_value->>'display_name',display_name),role=vrole where workspace_id=p_workspace and user_id=r.user_id and status='active';
 if not found then raise exception 'Membership unavailable';end if;
 else update public.workspace_invites set display_name=coalesce(p_value->>'display_name',display_name),role=vrole where id=r.invite_id and workspace_id=p_workspace and accepted_at is null and revoked_at is null and expires_at>now();if not found then raise exception 'Invitation unavailable';end if;end if;
 update public.delivery_rules set profile_ids=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_value->'profile_ids','[]'))),max_cards_per_day=coalesce((p_value->>'max_cards_per_day')::integer,10),no_repeat_days=coalesce((p_value->>'no_repeat_days')::integer,30),morning_email_time=nullif(p_value->>'morning_email_time','')::time,setup_revision=setup_revision+1 where id=r.id returning * into r;return to_jsonb(r);end;$$;
create function private.remove_signals_recipient(p_workspace uuid,p_id uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$declare r public.delivery_rules;begin
 perform private.require_signals_setup_admin(p_workspace);select * into r from public.delivery_rules where id=p_id and workspace_id=p_workspace for update;
 if r.id is null or r.setup_revision<>p_revision then raise exception 'Person changed elsewhere. Reload before removing.';end if;
 if r.user_id is not null then update public.workspace_members set status='suspended' where workspace_id=p_workspace and user_id=r.user_id;
 else update public.workspace_invites set revoked_at=now() where id=r.invite_id and accepted_at is null;end if;
 update public.delivery_rules set enabled=false,profile_ids='{}',morning_email_time=null,setup_revision=setup_revision+1 where id=r.id;end;$$;
create function private.restore_signals_recipient(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.delivery_rules;begin
 perform private.require_signals_setup_admin(p_workspace);select * into r from public.delivery_rules where id=p_id and workspace_id=p_workspace and not enabled and setup_revision=p_revision for update;
 if r.id is null then raise exception 'Person changed elsewhere. Reload before restoring.';end if;
 if r.user_id is not null then update public.workspace_members set status='active' where workspace_id=p_workspace and user_id=r.user_id;
 else update public.workspace_invites set revoked_at=null where id=r.invite_id and workspace_id=p_workspace and accepted_at is null and expires_at>now() and delivery_status='sent';if not found then raise exception 'Send a fresh invitation instead.';end if;end if;
 update public.delivery_rules set enabled=true,profile_ids=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_value->'profile_ids','[]'))),morning_email_time=nullif(p_value->>'morning_email_time','')::time,setup_revision=setup_revision+1 where id=r.id returning * into r;return to_jsonb(r);end;$$;
create function public.restore_signals_recipient(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.restore_signals_recipient(p_workspace,p_id,p_revision,p_value);$$;
revoke all on function private.restore_signals_recipient(uuid,uuid,integer,jsonb),public.restore_signals_recipient(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function private.restore_signals_recipient(uuid,uuid,integer,jsonb),public.restore_signals_recipient(uuid,uuid,integer,jsonb) to authenticated;
create function private.save_signals_extra_source(p_workspace uuid,p_id uuid,p_revision integer,p_url text) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.client_extra_sources;begin
 perform private.require_signals_setup_admin(p_workspace);
 if p_url !~ '^https://' or length(p_url)>2000 or p_url is null then raise exception 'Use a public HTTPS URL';end if;
 if p_id is null then insert into public.client_extra_sources(workspace_id,url) values(p_workspace,p_url) on conflict(workspace_id,url) do update set deleted_at=null returning * into r;
 else update public.client_extra_sources set url=p_url,validation_status='pending',detected_feed=null,last_error=null,checked_at=null,setup_revision=setup_revision+1 where id=p_id and workspace_id=p_workspace and setup_revision=p_revision and deleted_at is null returning * into r;
 if not found then raise exception 'Source changed elsewhere. Reload before saving.' using errcode='40001';end if;end if;return to_jsonb(r);end;$$;
create function private.delete_signals_extra_source(p_workspace uuid,p_id uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_signals_setup_admin(p_workspace);update public.client_extra_sources set deleted_at=now(),setup_revision=setup_revision+1 where id=p_id and workspace_id=p_workspace and setup_revision=p_revision and deleted_at is null;
 if not found then raise exception 'Source changed elsewhere. Reload before removing.';end if;end;$$;
create function public.save_signals_rule(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_signals_rule(p_workspace,p_id,p_revision,p_value);$$;
revoke all on function private.save_signals_rule(uuid,uuid,integer,jsonb),public.save_signals_rule(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function private.save_signals_rule(uuid,uuid,integer,jsonb),public.save_signals_rule(uuid,uuid,integer,jsonb) to authenticated;
create function public.delete_signals_rule(p_workspace uuid,p_id uuid,p_revision integer) returns void language sql security invoker set search_path='' as $$select private.delete_signals_rule(p_workspace,p_id,p_revision);$$;
revoke all on function private.delete_signals_rule(uuid,uuid,integer),public.delete_signals_rule(uuid,uuid,integer) from public,anon;
grant execute on function private.delete_signals_rule(uuid,uuid,integer),public.delete_signals_rule(uuid,uuid,integer) to authenticated;
create function public.save_signals_source(p_workspace uuid,p_key text,p_revision integer,p_enabled boolean,p_hours integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_signals_source(p_workspace,p_key,p_revision,p_enabled,p_hours);$$;
revoke all on function private.save_signals_source(uuid,text,integer,boolean,integer),public.save_signals_source(uuid,text,integer,boolean,integer) from public,anon;
grant execute on function private.save_signals_source(uuid,text,integer,boolean,integer),public.save_signals_source(uuid,text,integer,boolean,integer) to authenticated;
create function public.save_signals_voice(p_workspace uuid,p_revision integer,p_value jsonb) returns integer language sql security invoker set search_path='' as $$select private.save_signals_voice(p_workspace,p_revision,p_value);$$;
revoke all on function private.save_signals_voice(uuid,integer,jsonb),public.save_signals_voice(uuid,integer,jsonb) from public,anon;
grant execute on function private.save_signals_voice(uuid,integer,jsonb),public.save_signals_voice(uuid,integer,jsonb) to authenticated;
create function public.save_signals_delivery(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_signals_delivery(p_workspace,p_id,p_revision,p_value);$$;
revoke all on function private.save_signals_delivery(uuid,uuid,integer,jsonb),public.save_signals_delivery(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function private.save_signals_delivery(uuid,uuid,integer,jsonb),public.save_signals_delivery(uuid,uuid,integer,jsonb) to authenticated;
create function public.remove_signals_recipient(p_workspace uuid,p_id uuid,p_revision integer) returns void language sql security invoker set search_path='' as $$select private.remove_signals_recipient(p_workspace,p_id,p_revision);$$;
revoke all on function private.remove_signals_recipient(uuid,uuid,integer),public.remove_signals_recipient(uuid,uuid,integer) from public,anon;
grant execute on function private.remove_signals_recipient(uuid,uuid,integer),public.remove_signals_recipient(uuid,uuid,integer) to authenticated;
create function public.save_signals_extra_source(p_workspace uuid,p_id uuid,p_revision integer,p_url text) returns jsonb language sql security invoker set search_path='' as $$select private.save_signals_extra_source(p_workspace,p_id,p_revision,p_url);$$;
revoke all on function private.save_signals_extra_source(uuid,uuid,integer,text),public.save_signals_extra_source(uuid,uuid,integer,text) from public,anon;
grant execute on function private.save_signals_extra_source(uuid,uuid,integer,text),public.save_signals_extra_source(uuid,uuid,integer,text) to authenticated;
create function public.delete_signals_extra_source(p_workspace uuid,p_id uuid,p_revision integer) returns void language sql security invoker set search_path='' as $$select private.delete_signals_extra_source(p_workspace,p_id,p_revision);$$;
revoke all on function private.delete_signals_extra_source(uuid,uuid,integer),public.delete_signals_extra_source(uuid,uuid,integer) from public,anon;
grant execute on function private.delete_signals_extra_source(uuid,uuid,integer),public.delete_signals_extra_source(uuid,uuid,integer) to authenticated;
commit;
