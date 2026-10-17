begin;
-- Supports Supabase's current secret API keys as well as the legacy service JWT.
create function public.signals_collection_worker_access() returns boolean language sql stable security invoker set search_path='' as $$select coalesce(auth.jwt()->>'role','')='service_role';$$;
revoke all on function public.signals_collection_worker_access() from public,anon,authenticated;
grant execute on function public.signals_collection_worker_access() to service_role;
commit;
