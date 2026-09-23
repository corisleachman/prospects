
create table if not exists public.prospect_signal_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  actor_id text not null default 'harvestapi/linkedin-profile-posts',
  contact_count integer not null default 0 check (contact_count between 0 and 30),
  requested_posts_per_contact integer not null default 3 check (requested_posts_per_contact between 1 and 5),
  estimated_max_cost_usd numeric(8,4) not null default 0,
  actual_item_count integer not null default 0,
  apify_run_id text,
  error_message text
);
create table if not exists public.prospect_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  run_id uuid references public.prospect_signal_runs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  observed_at timestamptz,
  source_type text not null default 'linkedin_post',
  source_external_id text,
  source_url text not null,
  source_text text not null,
  author_name text,
  signal_polarity text check (signal_polarity is null or signal_polarity in ('opportunity','pressure','intent','perspective')),
  signal_category text,
  trigger_score smallint not null default 0 check (trigger_score between 0 and 3),
  need_score smallint not null default 0 check (need_score between 0 and 3),
  readiness_score smallint not null default 0 check (readiness_score between 0 and 2),
  fit_score smallint not null default 0 check (fit_score between 0 and 2),
  total_score smallint generated always as (trigger_score + need_score + readiness_score + fit_score) stored,
  working_hypothesis text,
  suggested_action text check (suggested_action is null or suggested_action in ('ignore','monitor','research','comment','connect','message','email')),
  outreach_angle text,
  review_status text not null default 'new' check (review_status in ('new','saved','dismissed','used')),
  raw_payload jsonb,
  unique (user_id, source_url)
);
alter table public.prospect_signal_runs enable row level security;
alter table public.prospect_signals enable row level security;
grant select, insert, update, delete on public.prospect_signal_runs to authenticated;
grant select, insert, update, delete on public.prospect_signals to authenticated;
revoke all on public.prospect_signal_runs from anon;
revoke all on public.prospect_signals from anon;
create policy "Users manage own signal runs" on public.prospect_signal_runs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage own prospect signals" on public.prospect_signals for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index prospect_signals_contact_idx on public.prospect_signals(contact_id, created_at desc);
create index prospect_signals_score_idx on public.prospect_signals(user_id, total_score desc, created_at desc);
create index prospect_signal_runs_user_idx on public.prospect_signal_runs(user_id, created_at desc);
