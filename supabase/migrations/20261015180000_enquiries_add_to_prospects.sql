-- "Add to prospects" on the Enquiries view: remember which contact an enquiry became.
alter table public.enquiries add column if not exists added_contact_id uuid references public.contacts(id) on delete set null;
create policy "owner update enquiries" on public.enquiries for update to authenticated
  using ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com')
  with check ((auth.jwt() ->> 'email') = 'corisleachman@googlemail.com');
grant update (added_contact_id) on public.enquiries to authenticated;
