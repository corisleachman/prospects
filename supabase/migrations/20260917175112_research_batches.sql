alter table public.contacts
  add column if not exists research_batch_at   timestamptz,
  add column if not exists research_skipped_at timestamptz;

create index if not exists idx_contacts_research_batch on public.contacts (research_batch_at)
  where research_batch_at is not null;
