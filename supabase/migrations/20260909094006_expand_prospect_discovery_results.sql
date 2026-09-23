alter table public.prospect_discoveries
  add column if not exists source_type text not null default 'linkedin_post',
  add column if not exists search_query text,
  add column if not exists author_info text,
  add column if not exists parent_post_text text,
  add column if not exists subject_score smallint not null default 0 check (subject_score between 0 and 3),
  add column if not exists recency_score smallint not null default 0 check (recency_score between 0 and 2),
  add column if not exists contribution_score smallint not null default 0 check (contribution_score between 0 and 2),
  add column if not exists audience_score smallint not null default 0 check (audience_score between 0 and 2),
  add column if not exists relationship_score smallint not null default 0 check (relationship_score between 0 and 1),
  add column if not exists working_hypothesis text,
  add column if not exists raw_payload jsonb;

create index if not exists prospect_discoveries_linkedin_idx
  on public.prospect_discoveries (user_id, linkedin_url);
create index if not exists prospect_discoveries_source_url_idx
  on public.prospect_discoveries (user_id, source_url);
