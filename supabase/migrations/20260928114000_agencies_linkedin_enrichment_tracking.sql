alter table public.agencies
  add column if not exists employee_count integer,
  add column if not exists linkedin_enriched_at timestamptz,
  add column if not exists linkedin_enrich_status text
    check (linkedin_enrich_status is null or linkedin_enrich_status in ('ok','not_found','no_match','error'));
comment on column public.agencies.linkedin_enriched_at is 'Last Apify company lookup (harvestapi/linkedin-company). Used to avoid paying twice.';
comment on column public.agencies.linkedin_enrich_status is 'Outcome of last lookup: ok | not_found | no_match (name search returned a different company) | error.';
