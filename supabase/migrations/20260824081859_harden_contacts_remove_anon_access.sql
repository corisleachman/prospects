-- Remove leftover public (anon) access to the contacts table.
-- The app authenticates as the owner and uses the "owner all contacts" policy,
-- so these anon policies are unused scaffolding and their removal does not affect the app.
drop policy if exists "anon can read contacts" on public.contacts;
drop policy if exists "anon can insert contacts" on public.contacts;
