begin;
-- Existing platform-only RLS also protects parsed output retained for validation audits.
alter table public.pipeline_ai_calls add column model_output jsonb;
alter table public.rewrite_calls add column model_output jsonb;
commit;
