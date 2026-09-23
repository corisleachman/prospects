
alter table public.contacts
  add column if not exists email_status text,
  add column if not exists email_source text,
  add column if not exists email_enriched_at timestamptz,
  add column if not exists headline text,
  add column if not exists seniority_level text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists company_domain text,
  add column if not exists company_linkedin_url text,
  add column if not exists company_industry text,
  add column if not exists company_revenue bigint,
  add column if not exists company_founded_year integer,
  add column if not exists company_description text,
  add column if not exists company_city text,
  add column if not exists company_country text,
  add column if not exists enriched_at timestamptz,
  add column if not exists enrichment_data jsonb;
