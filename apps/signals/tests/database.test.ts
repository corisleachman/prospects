import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const owner = "00000000-0000-0000-0000-000000000001",
  alice = "00000000-0000-0000-0000-000000000002",
  bob = "00000000-0000-0000-0000-000000000003",
  legacyReviewer = "00000000-0000-0000-0000-000000000004";
const db = new PGlite();
async function asUser<T>(user: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    return tx.query<T>(sql, params);
  });
}
async function adminScalar(sql: string, params: unknown[] = []) {
  const r = await asUser<{ id: string }>(owner, sql, params);
  return r.rows[0].id;
}

test("Phase 1 database access and invitation lifecycle", async (t) => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to public;
 insert into auth.users values ('${owner}','corisleachman@googlemail.com',now()),('${alice}','alice@example.test',now()),('${bob}','bob@example.test',now()),('${legacyReviewer}','researcher@example.test',now());`);
  const migrations = resolve("../../supabase/migrations");
  await db.exec(
    await readFile(
      resolve(migrations, "20260924120000_workspaces.sql"),
      "utf8",
    ),
  );
  await db.exec(`create table public.agencies(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),tier text);
 create table public.contacts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),agency_id uuid,status text,title text,created_at timestamptz default now());`);
  await db.exec(
    await readFile(
      resolve(
        migrations,
        "20261009112146_step_3a_campaign_evidence_foundation.sql",
      ),
      "utf8",
    ),
  );
  const migration = (await readdir(migrations)).find((n) =>
    n.endsWith("_signals_phase_one.sql"),
  )!;
  await db.exec(await readFile(resolve(migrations, migration), "utf8"));
  const prior = (
    await db.query<{ id: string }>(
      "insert into public.workspaces(name,slug) values('Existing other workspace','existing-other') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'client_admin','active')",
    [prior, legacyReviewer],
  );
  await asUser(
    legacyReviewer,
    "insert into public.campaigns(workspace_id,name) values($1,'Existing non-legacy behavior')",
    [prior],
  );
  const old = (
    await db.query<{ id: string }>(
      "select id from public.workspaces where is_legacy_default",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'client_admin','active')",
    [old, legacyReviewer],
  );
  const a = await adminScalar(
      "select public.create_signals_client('Client A','Europe/London') as id",
    ),
    b = await adminScalar(
      "select public.create_signals_client('Client B','America/New_York') as id",
    );
  await t.test(
    "verified legacy owner is the only seeded platform admin",
    async () => {
      assert.equal(
        (await asUser(owner, "select * from public.platform_admins")).rows
          .length,
        1,
      );
      assert.equal(
        (await asUser(alice, "select * from public.platform_admins")).rows
          .length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            `insert into public.platform_admins(user_id,workspace_id) values($1,$2)`,
            [alice, a],
          ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "non-admins cannot create clients or grant memberships",
    async () => {
      await assert.rejects(
        () =>
          asUser(
            alice,
            "select public.create_signals_client('Attacker','UTC')",
          ),
        /Not allowed/,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
            [a, alice],
          ),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "select public.create_signals_invite($1,'alice@example.test','client_admin',$2)",
            [a, "a".repeat(64)],
          ),
        /Not allowed/,
      );
    },
  );
  let invite = "";
  await t.test(
    "clients cannot be invited into legacy CRM; roles are checked in SQL",
    async () => {
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.create_signals_invite($1,'alice@example.test','client_user',$2)",
            [old, "a".repeat(64)],
          ),
        /Client unavailable/,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.create_signals_invite($1,'alice@example.test','owner',$2)",
            [a, "a".repeat(64)],
          ),
        /Invalid role/,
      );
      invite = await adminScalar(
        "select public.create_signals_invite($1,'alice@example.test','client_admin',$2) as id",
        [a, "a".repeat(64)],
      );
    },
  );
  await t.test(
    "wrong email cannot inspect or accept the invitation",
    async () => {
      assert.equal(
        (
          await asUser(bob, "select * from public.preview_signals_invite($1)", [
            "a".repeat(64),
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(bob, "select public.accept_signals_invite($1)", [
            "a".repeat(64),
          ]),
        /Invitation unavailable/,
      );
    },
  );
  await t.test(
    "the right verified user accepts once with the stored role",
    async () => {
      assert.equal(
        (
          await asUser(
            alice,
            "select * from public.preview_signals_invite($1)",
            ["a".repeat(64)],
          )
        ).rows.length,
        1,
      );
      await asUser(alice, "select public.accept_signals_invite($1)", [
        "a".repeat(64),
      ]);
      const r = await asUser<{ role: string }>(
        alice,
        "select role from public.workspace_members where workspace_id=$1 and user_id=$2",
        [a, alice],
      );
      assert.equal(r.rows[0].role, "client_admin");
      await assert.rejects(
        () =>
          asUser(alice, "select public.accept_signals_invite($1)", [
            "a".repeat(64),
          ]),
        /Invitation unavailable/,
      );
      assert.ok(
        (
          await db.query<{ accepted_at: string }>(
            "select accepted_at from public.workspace_invites where id=$1",
            [invite],
          )
        ).rows[0].accepted_at,
      );
    },
  );
  await t.test(
    "cross-workspace reads and invitation enumeration return nothing",
    async () => {
      const visible = await asUser<{ id: string }>(
        alice,
        "select id from public.workspaces",
      );
      assert.deepEqual(
        visible.rows.map((r) => r.id),
        [a],
      );
      assert.equal(
        (
          await asUser(alice, "select * from public.workspaces where id=$1", [
            b,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (await asUser(alice, "select * from public.workspace_invites")).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    "new client admin is read-only for campaign setup, unlike legacy role",
    async () => {
      await db.query(
        "insert into public.campaigns(workspace_id,name) values($1,'Client A profile')",
        [a],
      );
      assert.equal(
        (
          await asUser(
            alice,
            "select * from public.campaigns where workspace_id=$1",
            [a],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "insert into public.campaigns(workspace_id,name) values($1,'Tampered')",
            [a],
          ),
        /row-level security/,
      );
      await asUser(
        legacyReviewer,
        "insert into public.campaigns(workspace_id,name) values($1,'Legacy preserved')",
        [old],
      );
      assert.ok(
        (
          await asUser(
            legacyReviewer,
            "select * from public.campaigns where workspace_id=$1",
            [old],
          )
        ).rows.length,
      );
      assert.equal(
        (await asUser(alice, "select * from public.provider_payloads")).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    "expiry, revocation and failed delivery prevent acceptance",
    async () => {
      const id = await adminScalar(
        "select public.create_signals_invite($1,'bob@example.test','client_user',$2) as id",
        [b, "b".repeat(64)],
      );
      await db.query(
        "update public.workspace_invites set expires_at=now()-interval '1 minute' where id=$1",
        [id],
      );
      await assert.rejects(
        () =>
          asUser(bob, "select public.accept_signals_invite($1)", [
            "b".repeat(64),
          ]),
        /Invitation unavailable/,
      );
      const fresh = await adminScalar(
        "select public.create_signals_invite($1,'bob@example.test','client_user',$2) as id",
        [b, "c".repeat(64)],
      );
      await asUser(
        owner,
        "select public.mark_signals_invite_delivery($1,false)",
        [fresh],
      );
      await assert.rejects(
        () =>
          asUser(bob, "select public.accept_signals_invite($1)", [
            "c".repeat(64),
          ]),
        /Invitation unavailable/,
      );
    },
  );
  await t.test(
    "resending revokes the old token; existing members cannot upgrade themselves",
    async () => {
      await adminScalar(
        "select public.create_signals_invite($1,'alice@example.test','client_user',$2) as id",
        [a, "d".repeat(64)],
      );
      await adminScalar(
        "select public.create_signals_invite($1,'alice@example.test','client_user',$2) as id",
        [a, "e".repeat(64)],
      );
      await assert.rejects(
        () =>
          asUser(alice, "select public.accept_signals_invite($1)", [
            "d".repeat(64),
          ]),
        /Invitation unavailable/,
      );
      await asUser(alice, "select public.accept_signals_invite($1)", [
        "e".repeat(64),
      ]);
      assert.equal(
        (
          await asUser<{ role: string }>(
            alice,
            "select role from public.workspace_members where workspace_id=$1 and user_id=$2",
            [a, alice],
          )
        ).rows[0].role,
        "client_admin",
      );
    },
  );
  await t.test(
    "suspended members are not reactivated by a new invite",
    async () => {
      await db.query(
        "update public.workspace_members set status='suspended' where workspace_id=$1 and user_id=$2",
        [a, alice],
      );
      await adminScalar(
        "select public.create_signals_invite($1,'alice@example.test','client_user',$2) as id",
        [a, "f".repeat(64)],
      );
      await assert.rejects(
        () =>
          asUser(alice, "select public.accept_signals_invite($1)", [
            "f".repeat(64),
          ]),
        /Membership unavailable/,
      );
      assert.equal(
        (await asUser(alice, "select * from public.workspaces")).rows.length,
        0,
      );
    },
  );
  await t.test(
    "client user sees only their own workspace and cannot promote themselves",
    async () => {
      await adminScalar(
        "select public.create_signals_invite($1,'bob@example.test','client_user',$2) as id",
        [b, "2".repeat(64)],
      );
      await asUser(bob, "select public.accept_signals_invite($1)", [
        "2".repeat(64),
      ]);
      const visible = await asUser<{ id: string }>(
        bob,
        "select id from public.workspaces",
      );
      assert.deepEqual(
        visible.rows.map((r) => r.id),
        [b],
      );
      await assert.rejects(
        () =>
          asUser(
            bob,
            "update public.workspace_members set role='client_admin' where user_id=$1",
            [bob],
          ),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          asUser(
            bob,
            "insert into public.campaigns(workspace_id,name) values($1,'Injected')",
            [b],
          ),
        /row-level security/,
      );
    },
  );
  await t.test(
    "unverified email and anonymous callers fail closed",
    async () => {
      await db.query(
        "update auth.users set email_confirmed_at=null where id=$1",
        [bob],
      );
      await adminScalar(
        "select public.create_signals_invite($1,'bob@example.test','client_user',$2) as id",
        [b, "1".repeat(64)],
      );
      await assert.rejects(
        () =>
          asUser(bob, "select public.accept_signals_invite($1)", [
            "1".repeat(64),
          ]),
        /Invitation unavailable/,
      );
      await assert.rejects(
        () =>
          db.transaction(async (tx) => {
            await tx.exec("set local role anon");
            return tx.query("select public.accept_signals_invite($1)", [
              "1".repeat(64),
            ]);
          }),
        /permission denied/,
      );
    },
  );
  await t.test(
    "public Phase 1 RPCs are invokers; private definers pin search_path",
    async () => {
      const f = await db.query<{
        nspname: string;
        prosecdef: boolean;
        proconfig: string[];
      }>(
        "select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like $1",
        ["%signals_invite%"],
      );
      for (const r of f.rows) {
        if (r.nspname === "public") assert.equal(r.prosecdef, false);
        assert.ok(r.proconfig?.includes('search_path=""'));
      }
    },
  );
  await db.close();
});
