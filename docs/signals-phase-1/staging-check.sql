-- Run only on the disposable validation branch. All fixtures roll back.
begin;
create temporary table phase_one_fixture as
select gen_random_uuid() as owner_id, gen_random_uuid() as client_id;
grant select on phase_one_fixture to authenticated;
insert into auth.users(id,email,email_confirmed_at)
select owner_id,'owner@phase-one.example.test',now() from phase_one_fixture
union all select client_id,'client@phase-one.example.test',now() from phase_one_fixture;
insert into public.workspace_members(workspace_id,user_id,role,status)
select w.id,f.owner_id,'owner','active' from public.workspaces w cross join phase_one_fixture f where w.is_legacy_default;
insert into public.platform_admins(user_id,workspace_id)
select f.owner_id,w.id from phase_one_fixture f cross join public.workspaces w where w.is_legacy_default;
select set_config('request.jwt.claim.sub',owner_id::text,true) from phase_one_fixture;
set local role authenticated;
create temporary table phase_one_client as
select public.create_signals_client('Phase 1 rollback test','Europe/London') as workspace_id;
select public.create_signals_invite(workspace_id,'client@phase-one.example.test','client_user',repeat('a',64)) from phase_one_client;
select set_config('request.jwt.claim.sub',client_id::text,true) from phase_one_fixture;
do $$ begin
 if exists(select 1 from public.platform_admins) then raise exception 'Client can see admin authority'; end if;
 if exists(select 1 from public.workspaces) then raise exception 'Uninvited client can see workspaces'; end if;
 begin
  perform public.create_signals_client('Forbidden','Europe/London');
  raise exception 'Client created a workspace';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.preview_signals_invite(repeat('a',64)))<>1 then raise exception 'Invite preview failed'; end if;
 perform public.accept_signals_invite(repeat('a',64));
 if (select count(*) from public.workspaces)<>1 then raise exception 'Workspace isolation failed'; end if;
 if (select count(*) from public.workspace_members where user_id=auth.uid() and role='client_user')<>1 then raise exception 'Role assignment failed'; end if;
 begin
  perform public.accept_signals_invite(repeat('a',64));
  raise exception 'Invite replay accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.campaigns(workspace_id,name) select workspace_id,'Forbidden' from phase_one_client;
  raise exception 'Client can configure campaigns';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.contacts) then raise exception 'Client can see old CRM contacts'; end if;
end $$;
reset role;
select 'passed: admin RPC, invite acceptance, client isolation, blocked setup, replay rejection' as result;
rollback;
