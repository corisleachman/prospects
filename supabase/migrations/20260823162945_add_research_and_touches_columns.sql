alter table contacts
  add column if not exists research_summary text,
  add column if not exists research_at timestamptz,
  add column if not exists touches integer not null default 0;
