-- Step 1 verification queries. Read-only. Run after Stage 2 and after Stage 4.

-- 1. Every product row belongs to a workspace
select 'contacts' t, count(*) filter (where workspace_id is null) missing from public.contacts
union all select 'email_templates', count(*) filter (where workspace_id is null) from public.email_templates
union all select 'prospect_signals', count(*) filter (where workspace_id is null) from public.prospect_signals
union all select 'prospect_signal_runs', count(*) filter (where workspace_id is null) from public.prospect_signal_runs
union all select 'prospect_discoveries', count(*) filter (where workspace_id is null) from public.prospect_discoveries
union all select 'signal_copy_templates', count(*) filter (where workspace_id is null) from public.signal_copy_templates;

-- 2. Agencies: totals, and contacts with a company but no agency (should be 0)
select (select count(*) from public.agencies) agencies,
       (select count(*) from public.contacts where agency_id is not null) linked_contacts,
       (select count(*) from public.contacts where agency_id is null and nullif(trim(company),'') is not null) unlinked_with_company,
       (select count(*) from public.agencies where domain is not null) agencies_with_domain;

-- 3. Review list: likely duplicates the name key did not merge
--    (same domain, or one name key is the start of another, e.g. ourselves / ourselvescreativestudio)
select 'same domain' why, a.name, b.name as other
from public.agencies a join public.agencies b
  on a.workspace_id = b.workspace_id and a.domain = b.domain and a.id < b.id
union all
select 'name prefix', a.name, b.name
from public.agencies a join public.agencies b
  on a.workspace_id = b.workspace_id and a.id <> b.id
 and length(a.name_key) >= 5 and b.name_key like a.name_key || '%' and b.name_key <> a.name_key
order by 1, 2;

-- 4. Review list: generic names that may have merged unrelated companies
select name, name_key, (select count(*) from public.contacts c where c.agency_id = a.id) contacts
from public.agencies a
where length(name_key) <= 5 or name_key in ('agency','studio','creative','design','digital','media','group','consulting')
order by contacts desc;

-- 5. Security: nothing callable by anon, no anon table access beyond enquiries insert
select routine_name, grantee from information_schema.routine_privileges
 where routine_schema = 'public' and grantee in ('anon','authenticated') and routine_name in ('notify_enquiry_fn','rls_auto_enable');
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon' order by 1, 2;
