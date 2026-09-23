alter table public.contacts
  add column if not exists verification_status      text not null default 'unverified',
  add column if not exists verified_at              timestamptz,
  add column if not exists verified_by              text,
  add column if not exists verification_notes       text,
  add column if not exists linkedin_research_notes  text,
  add column if not exists interesting_post_url     text,
  add column if not exists interesting_post_summary text,
  add column if not exists human_signal_strength    text,
  add column if not exists news_research_notes      text,
  add column if not exists research_source_url      text,
  add column if not exists mutual_connection_notes  text,
  add column if not exists research_completed_at    timestamptz;

alter table public.contacts drop constraint if exists contacts_verification_status_chk;
alter table public.contacts add constraint contacts_verification_status_chk
  check (verification_status in
    ('unverified','verified','research_complete','ready_for_coris','needs_coris_review','removed'));

alter table public.contacts drop constraint if exists contacts_human_signal_strength_chk;
alter table public.contacts add constraint contacts_human_signal_strength_chk
  check (human_signal_strength is null or human_signal_strength in ('strong','maybe','nothing'));

create index if not exists idx_contacts_verification_status on public.contacts (verification_status);
create index if not exists idx_contacts_ready_for_coris on public.contacts (verification_status)
  where verification_status = 'ready_for_coris';
