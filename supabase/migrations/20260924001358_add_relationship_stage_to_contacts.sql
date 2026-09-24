-- Relationship stage (1-6) from the Outreach Playbook nurture model:
-- 1 Recognition, 2 Relevance, 3 Value, 4 Conversation, 5 Proof, 6 Opportunity.
-- Null means the stage hasn't been set yet. Separate from warmth, which is
-- prioritisation (hot/warm/nurture/cold), not the state of the relationship.
--
-- Status on the live project: APPLIED 24 Sep 2026 via the Supabase connector,
-- recorded in history as 20260924001358 add_relationship_stage_to_contacts.
-- Additive only. Independent of the Step 1 foundation migrations (20260923*),
-- which were still unapplied on the live project when this ran.
alter table public.contacts
  add column if not exists relationship_stage smallint,
  add column if not exists relationship_stage_changed_at timestamptz;

alter table public.contacts drop constraint if exists contacts_relationship_stage_check;
alter table public.contacts add constraint contacts_relationship_stage_check
  check (relationship_stage is null or relationship_stage between 1 and 6);

comment on column public.contacts.relationship_stage is
  'Nurture stage 1-6: Recognition, Relevance, Value, Conversation, Proof, Opportunity. Null = not set.';
comment on column public.contacts.relationship_stage_changed_at is
  'When relationship_stage last changed. Maintained by trigger b20_stamp_relationship_stage.';

create or replace function public.stamp_relationship_stage_changed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.relationship_stage is not null then
      new.relationship_stage_changed_at := coalesce(new.relationship_stage_changed_at, now());
    end if;
  elsif new.relationship_stage is distinct from old.relationship_stage then
    new.relationship_stage_changed_at := case when new.relationship_stage is null then null else now() end;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_relationship_stage_changed_at() from public, anon, authenticated;

drop trigger if exists b20_stamp_relationship_stage on public.contacts;
create trigger b20_stamp_relationship_stage
  before insert or update of relationship_stage on public.contacts
  for each row execute function public.stamp_relationship_stage_changed_at();
