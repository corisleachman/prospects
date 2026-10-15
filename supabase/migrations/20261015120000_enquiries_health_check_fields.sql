-- Health check leads from corisleachman.com land in enquiries with source = 'health_check'.
alter table public.enquiries
  add column if not exists job_title text,
  add column if not exists score integer check (score between 0 and 100),
  add column if not exists tier text,
  add column if not exists results jsonb,
  add column if not exists email_status text;
comment on column public.enquiries.source is 'guide = build guide form; health_check = website health check';
