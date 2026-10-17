begin;
grant select on public.person_lookup_calls to authenticated;
create policy "platform reads person search receipts" on public.person_lookup_calls for select to authenticated using ((select private.is_platform_admin()));
commit;
