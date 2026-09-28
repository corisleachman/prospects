alter table public.agencies drop constraint if exists agencies_linkedin_enrich_status_check;
alter table public.agencies add constraint agencies_linkedin_enrich_status_check
  check (linkedin_enrich_status is null or linkedin_enrich_status in ('ok','matched_by_name','not_found','no_match','error'));
comment on column public.agencies.linkedin_enrich_status is
  'Last Apify company lookup: ok (via LinkedIn URL or website domain confirmed) | matched_by_name (name + location only - worth a glance) | not_found | no_match | error.';

-- Atomically claim a batch of agencies that still need a LinkedIn lookup, so several
-- backfill workers can run in parallel without paying for the same company twice.
create or replace function public.claim_agencies_for_linkedin_enrichment(batch_size int)
returns setof public.agencies
language sql
security definer
set search_path = ''
as $$
  update public.agencies a
     set linkedin_enriched_at = now(), linkedin_enrich_status = null
   where a.id in (
     select id from public.agencies
      where linkedin_enriched_at is null
        and coalesce(tier, '') <> 'excluded'
        and (website is null or linkedin_url is null or linkedin_url ~ '/company/\d+/?$')
      order by created_at
      limit greatest(1, least(batch_size, 50))
      for update skip locked)
  returning a.*;
$$;
revoke all on function public.claim_agencies_for_linkedin_enrichment(int) from public, anon, authenticated;
grant execute on function public.claim_agencies_for_linkedin_enrichment(int) to service_role;
