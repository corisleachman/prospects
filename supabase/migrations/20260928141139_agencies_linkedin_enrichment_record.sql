alter table public.agencies add column if not exists linkedin_enrichment jsonb;
comment on column public.agencies.linkedin_enrichment is
  'What the last LinkedIn company lookup matched and wrote: {linkedin_name, linkedin_url, filled[], at, reconstructed?, reviewed?, rejected?}. Lets a wrong match be undone field-by-field.';
