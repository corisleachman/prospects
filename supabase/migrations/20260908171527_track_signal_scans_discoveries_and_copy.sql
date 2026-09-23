alter table public.contacts
  add column if not exists signal_scanned_at timestamptz,
  add column if not exists signal_scan_run_id uuid references public.prospect_signal_runs(id) on delete set null;

create index if not exists contacts_signal_scanned_at_idx
  on public.contacts (signal_scanned_at desc);

update public.contacts c
set signal_scanned_at = x.last_scanned_at,
    signal_scan_run_id = x.run_id
from (
  select distinct on (s.contact_id)
    s.contact_id,
    r.completed_at as last_scanned_at,
    r.id as run_id
  from public.prospect_signals s
  join public.prospect_signal_runs r on r.id = s.run_id
  where r.status = 'succeeded' and r.completed_at is not null
  order by s.contact_id, r.completed_at desc
) x
where c.id = x.contact_id
  and c.signal_scanned_at is null;

create table if not exists public.prospect_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  observed_at timestamptz,
  linkedin_url text not null,
  name text,
  company text,
  title text,
  source_url text not null,
  source_text text not null,
  signal_category text,
  signal_polarity text check (signal_polarity is null or signal_polarity in ('opportunity','pressure','intent','perspective')),
  total_score smallint not null default 0 check (total_score between 0 and 10),
  suggested_action text,
  draft_copy text,
  review_status text not null default 'new' check (review_status in ('new','saved','added','dismissed')),
  added_contact_id uuid references public.contacts(id) on delete set null,
  unique (user_id, linkedin_url, source_url)
);

alter table public.prospect_discoveries enable row level security;
drop policy if exists "Users manage own prospect discoveries" on public.prospect_discoveries;
create policy "Users manage own prospect discoveries"
  on public.prospect_discoveries for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.prospect_discoveries to authenticated;
revoke all on public.prospect_discoveries from anon;
create index if not exists prospect_discoveries_user_status_score_idx
  on public.prospect_discoveries (user_id, review_status, total_score desc, observed_at desc);

create table if not exists public.signal_copy_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  signal_key text not null,
  label text not null,
  detected_signal text not null,
  possible_meaning text not null,
  best_action text not null,
  copy_example text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, signal_key)
);

alter table public.signal_copy_templates enable row level security;
drop policy if exists "Users manage own signal copy templates" on public.signal_copy_templates;
create policy "Users manage own signal copy templates"
  on public.signal_copy_templates for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.signal_copy_templates to authenticated;
revoke all on public.signal_copy_templates from anon;
create index if not exists signal_copy_templates_user_idx
  on public.signal_copy_templates (user_id, signal_key);
