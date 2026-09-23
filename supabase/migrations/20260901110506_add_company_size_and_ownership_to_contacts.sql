alter table public.contacts
  add column if not exists company_size text,
  add column if not exists ownership text;
