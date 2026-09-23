-- DRIFT CAPTURE (reconstructed 23 Sep 2026)
-- contacts.email_candidates was added on the live project around commit
-- edb7d93 (20 Sep 2026) without a tracked migration.
-- Status on the live project: ALREADY APPLIED. Register in history only.
alter table public.contacts
  add column if not exists email_candidates jsonb not null default '[]'::jsonb;
