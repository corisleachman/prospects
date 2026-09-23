alter table public.contacts add column if not exists warmth text;
alter table public.contacts drop constraint if exists contacts_warmth_check;
alter table public.contacts add constraint contacts_warmth_check check (warmth is null or warmth in ('hot','warm','nurture','cold'));
