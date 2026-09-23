alter table public.contacts
  add column if not exists coris_action_note text,
  add column if not exists coris_actioned_at timestamptz,
  add column if not exists coris_check_in_at date;

alter table public.contacts drop constraint if exists contacts_verification_status_chk;
alter table public.contacts add constraint contacts_verification_status_chk
  check (verification_status in
    ('unverified','verified','research_complete','ready_for_coris','needs_coris_review','processed','removed'));

create index if not exists idx_contacts_coris_check_in on public.contacts (coris_check_in_at)
  where verification_status = 'processed';
