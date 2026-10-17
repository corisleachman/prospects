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
  await db.exec(
    await readFile(
      resolve(migrations, "20261016165335_signals_phase_two.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Phase 2 saves optional criteria and rejects stale revisions",
    async () => {
      const profile = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [a],
      );
      const payload = {
        name: "Consumer brands",
        criteria: {
          industries: ["Food"],
          named_companies: [
            {
              name: "Example",
              include_parent: true,
              include_sub_brands: false,
            },
          ],
        },
        who: "CMOs",
      };
      const saved = await asUser<{ revision: number }>(
        owner,
        "select public.save_signals_profile($1,$2,0,$3::jsonb) as revision",
        [a, profile, JSON.stringify(payload)],
      );
      assert.equal(saved.rows[0].revision, 1);
      const row = (
        await asUser<{
          criteria: unknown;
          who: string;
          watch_list_size: number;
        }>(
          owner,
          "select criteria,who,watch_list_size from public.campaigns where id=$1",
          [profile],
        )
      ).rows[0];
      assert.deepEqual(row.criteria, payload.criteria);
      assert.equal(row.who, "CMOs");
      assert.equal(row.watch_list_size, 200);
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.save_signals_profile($1,$2,0,$3::jsonb)",
            [a, profile, JSON.stringify(payload)],
          ),
        /changed elsewhere/,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.save_signals_profile($1,$2,1,$3::jsonb)",
            [b, profile, JSON.stringify(payload)],
          ),
        /changed elsewhere/,
      );
    },
  );
  await t.test(
    "Phase 2 database caps apply to RPC and direct inserts; downgrade fails",
    async () => {
      for (
        let i = Number(
          (
            await db.query<{ n: number }>(
              "select count(*)::int as n from public.campaigns where workspace_id=$1 and status<>'archived'",
              [a],
            )
          ).rows[0].n,
        );
        i < 5;
        i++
      )
        await adminScalar("select public.create_signals_profile($1) as id", [
          a,
        ]);
      await assert.rejects(
        () =>
          adminScalar("select public.create_signals_profile($1) as id", [a]),
        /Profile limit reached/,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "insert into public.campaigns(workspace_id,name) values($1,'Direct extra')",
            [a],
          ),
        /Profile limit reached/,
      );
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_client($1,0,$2::jsonb)", [
            a,
            JSON.stringify({
              name: "Client A",
              timezone: "Europe/London",
              profile_limit: 2,
            }),
          ]),
        /fewer profiles/,
      );
      const saved = await asUser<{ revision: number }>(
        owner,
        "select public.save_signals_client($1,0,$2::jsonb) as revision",
        [
          a,
          JSON.stringify({
            name: "Client A updated",
            timezone: "America/New_York",
            profile_limit: 10,
            logo_url: "https://example.test/logo.png",
          }),
        ],
      );
      assert.equal(saved.rows[0].revision, 1);
      await adminScalar("select public.create_signals_profile($1) as id", [a]);
    },
  );
  await t.test(
    "Phase 2 setup and shared entities remain inaccessible to client roles",
    async () => {
      await assert.rejects(
        () => asUser(alice, "select public.create_signals_profile($1)", [a]),
        /Not allowed/,
      );
      await assert.rejects(
        () =>
          asUser(alice, "select public.save_signals_client($1,1,'{}'::jsonb)", [
            a,
          ]),
        /Not allowed/,
      );
      assert.equal(
        (await asUser(alice, "select * from public.signals_team($1)", [a])).rows
          .length,
        0,
      );
      await asUser(
        owner,
        "insert into public.companies(workspace_id,name,domain) values($1,'Example','example.test')",
        [a],
      );
      assert.equal(
        (await asUser(alice, "select * from public.companies")).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "insert into public.people(workspace_id,name) values($1,'Injected')",
            [a],
          ),
        /row-level security/,
      );
      await assert.rejects(
        () =>
          adminScalar("select public.create_signals_profile($1) as id", [old]),
        /Client unavailable/,
      );
    },
  );
  await db.exec(
    `create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`,
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261016222233_signals_phase_three.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Phase 3 reservations, thresholds, failed costs, hard cap and renewals",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Budget test','Europe/London') as id",
      );
      const bid = await adminScalar(
        "select public.change_signals_budget($1,'create',10,current_date,current_date+30,'Test',false) as id",
        [w],
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "select public.change_signals_budget($1,'top_up',5,null,null,'',false)",
            [w],
          ),
        /Not allowed/,
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.reserve_signals_cost($1,'optional',1,true) as id",
            [w],
          ),
        /Daily soft cap/,
      );
      const r = await adminScalar(
        "select public.reserve_signals_cost($1,'watched',8,false) as id",
        [w],
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.reserve_signals_cost($1,'parallel',3,false) as id",
            [w],
          ),
        /Hard cap/,
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.change_signals_budget($1,'renew',10,current_date,current_date+30,'',true) as id",
            [w],
          ),
        /pending calls/,
      );
      const details = JSON.stringify({
        stage: "triage",
        provider: "fixture",
        cost_basis: "reported",
        outcome: "failed",
        batch: true,
        cached: true,
        units: { input_tokens: 10, cache_read_input_tokens: 5 },
      });
      const cost = await adminScalar(
        "select public.settle_signals_cost($1,8,$2::jsonb) as id",
        [r, details],
      );
      assert.equal(
        await adminScalar(
          "select public.settle_signals_cost($1,8,$2::jsonb) as id",
          [r, details],
        ),
        cost,
      );
      assert.equal(
        (
          await asUser(
            owner,
            "select threshold from public.budget_alerts where budget_id=$1",
            [bid],
          )
        ).rows.length,
        1,
      );
      await assert.rejects(
        () =>
          db.query("update public.cost_ledger set cost=0 where id=$1", [cost]),
        /append-only/,
      );
      const finishReservation = await adminScalar(
        "select public.reserve_signals_cost($1,'finish',2,false) as id",
        [w],
      );
      await adminScalar(
        "select public.settle_signals_cost($1,2,$2::jsonb) as id",
        [finishReservation, details],
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from public.client_budgets where id=$1",
            [bid],
          )
        ).rows[0].status,
        "spent",
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from public.workspaces where id=$1",
            [w],
          )
        ).rows[0].status,
        "paused",
      );
      assert.equal(
        (
          await asUser(
            owner,
            "select threshold from public.budget_alerts where budget_id=$1",
            [bid],
          )
        ).rows.length,
        2,
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.reserve_signals_cost($1,'blocked',1,false) as id",
            [w],
          ),
        /paused/,
      );
      await adminScalar(
        "select public.change_signals_budget($1,'top_up',5,null,null,'More headroom',false) as id",
        [w],
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from public.workspaces where id=$1",
            [w],
          )
        ).rows[0].status,
        "setup",
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.change_signals_budget($1,'change',9,null,null,'Too low',false) as id",
            [w],
          ),
        /smaller than/,
      );
      const over = await adminScalar(
        "select public.reserve_signals_cost($1,'overrun',1,false) as id",
        [w],
      );
      await adminScalar(
        "select public.settle_signals_cost($1,7,$2::jsonb) as id",
        [over, details],
      );
      assert.equal(
        Number(
          (
            await db.query<{ cost: number }>(
              "select sum(cost) as cost from public.cost_ledger where budget_id=$1",
              [bid],
            )
          ).rows[0].cost,
        ),
        17,
      );
      const next = await adminScalar(
        "select public.change_signals_budget($1,'renew',20,current_date,current_date+30,'Fresh period',false) as id",
        [w],
      );
      assert.notEqual(next, bid);
      await assert.rejects(
        () =>
          adminScalar(
            "select public.add_signals_test_cost($1,1,'no-fake-real') as id",
            [w],
          ),
        /only allowed/,
      );
      assert.equal(
        (await asUser(alice, "select * from public.cost_ledger")).rows.length,
        0,
      );
      assert.equal(
        (
          await asUser<{ data: unknown }>(
            alice,
            "select public.signals_budget_overview($1) as data",
            [w],
          )
        ).rows[0].data,
        null,
      );
      const cancel = await adminScalar(
        "select public.reserve_signals_cost($1,'cancelled',2,false) as id",
        [w],
      );
      await asUser(owner, "select public.cancel_signals_cost($1)", [cancel]);
      const overview = (
        await asUser<{ data: { spent: number; reserved: number } }>(
          owner,
          "select public.signals_budget_overview($1) as data",
          [w],
        )
      ).rows[0].data;
      assert.equal(Number(overview.spent), 0);
      assert.equal(Number(overview.reserved), 0);
      assert.equal(
        (
          await asUser(
            owner,
            "select * from public.budget_history where workspace_id=$1",
            [w],
          )
        ).rows.length,
        3,
      );
    },
  );
  await t.test(
    "test budgets reject provider reservations and fake charges stay labelled",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Fake only','Europe/London') as id",
      );
      await adminScalar(
        "select public.change_signals_budget($1,'create',10,current_date,current_date+30,'Test',true) as id",
        [w],
      );
      await assert.rejects(
        () =>
          adminScalar(
            "select public.reserve_signals_cost($1,'paid',1,false) as id",
            [w],
          ),
        /explicit fake costs/,
      );
      await adminScalar(
        "select public.add_signals_test_cost($1,10,'fake') as id",
        [w],
      );
      assert.equal(
        (
          await db.query<{ is_test: boolean }>(
            "select is_test from public.cost_ledger where workspace_id=$1",
            [w],
          )
        ).rows[0].is_test,
        true,
      );
    },
  );
  await t.test(
    "budget alert failures retry without duplicating sent alerts",
    async () => {
      const alert = (
        await asUser<{ id: string }>(
          owner,
          "select id from public.budget_alerts where status='pending' limit 1",
        )
      ).rows[0];
      await asUser(owner, "select public.mark_signals_budget_alert($1,false)", [
        alert.id,
      ]);
      await asUser(owner, "select public.mark_signals_budget_alert($1,true)", [
        alert.id,
      ]);
      await asUser(owner, "select public.mark_signals_budget_alert($1,false)", [
        alert.id,
      ]);
      const row = (
        await asUser<{ status: string; attempts: number }>(
          owner,
          "select status,attempts from public.budget_alerts where id=$1",
          [alert.id],
        )
      ).rows[0];
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 2);
      await assert.rejects(
        () =>
          asUser(alice, "select public.mark_signals_budget_alert($1,true)", [
            alert.id,
          ]),
        /Not allowed/,
      );
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261016225719_signals_phase_four.sql"),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017124341_signals_ui_catchup.sql"),
      "utf8",
    ),
  );
  async function service<T>(sql: string, params: unknown[] = []) {
    return db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      return tx.query<T>(sql, params);
    });
  }
  await t.test(
    "Phase 4 approved quotes escrow calls, settle receipts and save only selected entities",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Discovery test','Europe/London') as id",
      );
      const profile = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      await adminScalar(
        "select public.change_signals_budget($1,'create',10,current_date,current_date+30,'Discovery',false) as id",
        [w],
      );
      const result = {
        companies: [
          {
            key: "domain:one.test",
            name: "One",
            domain: "one.test",
            website: "https://one.test",
            linkedin_url: "https://www.linkedin.com/company/one",
            source: "discovered",
          },
          {
            key: "domain:two.test",
            name: "Two",
            domain: "two.test",
            website: "https://two.test",
            linkedin_url: "https://www.linkedin.com/company/two",
            source: "discovered",
          },
        ],
        people: [
          {
            key: "person:alex|one",
            name: "Alex Example",
            company_key: "domain:one.test",
            title: "CMO",
            linkedin_url: "https://www.linkedin.com/in/alex",
          },
        ],
        warnings: [],
      };
      const plan = { fx: 1, profile: { watch_revision: 0 } };
      const id = (
        await service<{ id: string }>(
          "insert into public.discovery_previews(workspace_id,profile_id,profile_revision,plan,estimated_gbp,created_by) values($1,$2,0,$3,1,$4) returning id",
          [w, profile, JSON.stringify(plan), owner],
        )
      ).rows[0].id;
      await db.query(
        "update public.discovery_previews set created_at=now()-interval '31 minutes' where id=$1",
        [id],
      );
      await assert.rejects(
        () =>
          adminScalar("select public.start_signals_discovery($1) as id", [id]),
        /expired/,
      );
      await db.query(
        "update public.discovery_previews set created_at=now(),profile_revision=999 where id=$1",
        [id],
      );
      await assert.rejects(
        () =>
          adminScalar("select public.start_signals_discovery($1) as id", [id]),
        /Profile changed/,
      );
      await db.query(
        "update public.discovery_previews set profile_revision=0 where id=$1",
        [id],
      );
      await assert.rejects(
        () => asUser(alice, "select public.start_signals_discovery($1)", [id]),
        /Not allowed/,
      );
      await adminScalar("select public.start_signals_discovery($1) as id", [
        id,
      ]);
      await assert.rejects(
        () =>
          adminScalar("select public.start_signals_discovery($1) as id", [id]),
        /unavailable or expired/,
      );
      const claim = (
        await service<{ data: { reservation: string } }>(
          "select public.claim_signals_discovery_step($1,.2) as data",
          [id],
        )
      ).rows[0].data;
      assert.equal(
        (
          await service<{ data: unknown }>(
            "select public.claim_signals_discovery_step($1,.2) as data",
            [id],
          )
        ).rows[0].data,
        null,
      );
      const held = (
        await db.query<{ n: number }>(
          "select sum(estimated_cost) as n from public.cost_reservations where workspace_id=$1 and status='reserved'",
          [w],
        )
      ).rows[0].n;
      assert.equal(Number(held), 1);
      await service(
        "select public.finish_signals_discovery_step($1,$2,.1,$3,$4,$5,true,null)",
        [
          id,
          claim.reservation,
          JSON.stringify({
            stage: "find",
            provider: "treg",
            source_key: "fixture",
            cost_basis: "reported",
            outcome: "success",
            units: { provider_cost_usd: 0.1 },
          }),
          JSON.stringify(result),
          JSON.stringify(plan),
        ],
      );
      assert.equal(
        Number(
          (
            await db.query<{ n: number }>(
              "select sum(cost) as n from public.cost_ledger where workspace_id=$1",
              [w],
            )
          ).rows[0].n,
        ),
        0.1,
      );
      assert.equal(
        Number(
          (
            await db.query<{ n: number }>(
              "select coalesce(sum(estimated_cost),0) as n from public.cost_reservations where workspace_id=$1 and status='reserved'",
              [w],
            )
          ).rows[0].n,
        ),
        0,
      );
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_watchlist($1,$2,$3)", [
            id,
            JSON.stringify(["inject"]),
            JSON.stringify([]),
          ]),
        /outside this preview/,
      );
      await asUser(owner, "select public.save_signals_watchlist($1,$2,$3)", [
        id,
        JSON.stringify(["domain:one.test", "domain:two.test"]),
        JSON.stringify(["person:alex|one"]),
      ]);
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_watchlist($1,$2,$3)", [
            id,
            JSON.stringify(["domain:two.test"]),
            JSON.stringify(["person:alex|one"]),
          ]),
        /company too/,
      );
      assert.equal(
        (
          await asUser(
            owner,
            "select * from public.campaign_prospects where campaign_id=$1",
            [profile],
          )
        ).rows.length,
        3,
      );
      await asUser(owner, "select public.save_signals_watchlist($1,$2,$3)", [
        id,
        JSON.stringify(["domain:one.test"]),
        JSON.stringify(["person:alex|one"]),
      ]);
      assert.equal(
        (
          await asUser(
            owner,
            "select * from public.campaign_prospects where campaign_id=$1",
            [profile],
          )
        ).rows.length,
        2,
      );
      assert.equal(
        (await asUser(alice, "select * from public.discovery_previews")).rows
          .length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(alice, "select public.set_signals_refresh($1,true)", [
            profile,
          ]),
        /Not allowed/,
      );
      await asUser(owner, "select public.set_signals_refresh($1,true)", [
        profile,
      ]);
      assert.equal(
        (
          await db.query<{ enabled: boolean }>(
            "select watch_refresh_enabled as enabled from public.campaigns where id=$1",
            [profile],
          )
        ).rows[0].enabled,
        true,
      );
    },
  );
  await t.test(
    "Phase 4 lost receipts settle once at the cap and stop retries",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Lost receipt','Europe/London') as id",
      );
      const p = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      await adminScalar(
        "select public.change_signals_budget($1,'create',10,current_date,current_date+30,'Lost receipt',false) as id",
        [w],
      );
      const q = (
        await db.query<{ id: string }>(
          "insert into public.discovery_previews(workspace_id,profile_id,profile_revision,plan,estimated_gbp) values($1,$2,0,'{\"fx\":1}',1) returning id",
          [w, p],
        )
      ).rows[0].id;
      await adminScalar("select public.start_signals_discovery($1) as id", [q]);
      await service("select public.claim_signals_discovery_step($1,.2)", [q]);
      await db.query(
        "update public.discovery_previews set lease_until=now()-interval '1 minute' where id=$1",
        [q],
      );
      await service("select public.recover_signals_discovery()");
      await service("select public.recover_signals_discovery()");
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from public.discovery_previews where id=$1",
            [q],
          )
        ).rows[0].status,
        "failed",
      );
      assert.equal(
        Number(
          (
            await db.query<{ cost: number }>(
              "select sum(cost) as cost from public.cost_ledger where workspace_id=$1",
              [w],
            )
          ).rows[0].cost,
        ),
        0.2,
      );
      assert.equal(
        (
          await db.query(
            "select 1 from public.cost_reservations where workspace_id=$1 and status='reserved'",
            [w],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "profile codes are unique within a client, not across clients",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Codes','Europe/London') as id",
      );
      const p = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      const p2 = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      const rows = (
        await db.query<{ code: string }>(
          "select code from public.campaigns where workspace_id=$1 order by code",
          [w],
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.code),
        ["01", "02"],
      );
      await asUser(owner, "select public.save_signals_profile($1,$2,0,$3)", [
        w,
        p,
        JSON.stringify({ name: "First", code: "01B" }),
      ]);
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_profile($1,$2,0,$3)", [
            w,
            p2,
            JSON.stringify({ name: "Second", code: "01B" }),
          ]),
        /duplicate key/,
      );
      await assert.rejects(
        () =>
          asUser(alice, "select public.save_signals_profile($1,$2,1,$3)", [
            w,
            p,
            JSON.stringify({ name: "Hack", code: "XXX" }),
          ]),
        /Not allowed/,
      );
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017133154_signals_phase_five.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Phase 5 seeds per-client rules and sources without changing the legacy library",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Phase 5','Europe/London') as id",
      );
      assert.equal(
        (
          await db.query(
            "select 1 from public.signal_definitions where workspace_id=$1 and template_key is not null",
            [w],
          )
        ).rows.length,
        9,
      );
      assert.equal(
        (
          await db.query(
            "select 1 from public.workspace_source_settings where workspace_id=$1",
            [w],
          )
        ).rows.length,
        4,
      );
      const p = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      assert.ok(
        (
          await db.query(
            "select 1 from public.campaign_source_rules where campaign_id=$1",
            [p],
          )
        ).rows.length === 4,
      );
      const val = {
        label: "Agency phrases",
        description: "A live creative search",
        polarity: "neutral",
        keywords: ['"agency of record"', "agency review", "-recruitment"],
        is_active: true,
        applies_to_all: false,
        profile_ids: [p],
      };
      const r = (
        await asUser<{ r: { id: string; setup_revision: number } }>(
          owner,
          "select public.save_signals_rule($1,null,0,$2) as r",
          [w, JSON.stringify(val)],
        )
      ).rows[0].r;
      await assert.rejects(
        () =>
          asUser(alice, "select public.save_signals_rule($1,$2,1,$3)", [
            w,
            r.id,
            JSON.stringify(val),
          ]),
        /Not allowed/,
      );
      assert.deepEqual(
        (
          await db.query<{ keywords: string[] }>(
            "select keywords from public.signal_definitions where id=$1",
            [r.id],
          )
        ).rows[0].keywords,
        val.keywords,
      );
      await asUser(owner, "select public.save_signals_rule($1,$2,$3,$4)", [
        w,
        r.id,
        r.setup_revision,
        JSON.stringify({ ...val, polarity: "negative" }),
      ]);
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_rule($1,$2,$3,$4)", [
            w,
            r.id,
            r.setup_revision,
            JSON.stringify(val),
          ]),
        /changed elsewhere/,
      );
      assert.equal(
        (await asUser(alice, "select * from public.voice_profiles")).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    "Phase 5 routing survives acceptance, rejects foreign profiles, and removes access with undo",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Routing test','Europe/London') as id",
      );
      const p = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [w],
      );
      const foreign = await adminScalar(
        "select public.create_signals_profile($1) as id",
        [b],
      );
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [bob],
      );
      const token = "9".repeat(64);
      const invite = await adminScalar(
        "select public.create_signals_invite($1,'bob@example.test','client_user',$2) as id",
        [w, token],
      );
      await asUser(
        owner,
        "select public.mark_signals_invite_delivery($1,true)",
        [invite],
      );
      const route = (
        await db.query<{ id: string; setup_revision: number }>(
          "select id,setup_revision from public.delivery_rules where invite_id=$1",
          [invite],
        )
      ).rows[0];
      const value = {
        display_name: "Bob",
        role: "client_user",
        profile_ids: [p],
        max_cards_per_day: 5,
        no_repeat_days: 30,
        morning_email_time: "08:00",
      };
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_delivery($1,$2,$3,$4)", [
            w,
            route.id,
            route.setup_revision,
            JSON.stringify({ ...value, profile_ids: [foreign] }),
          ]),
        /Profiles must belong/,
      );
      await asUser(owner, "select public.save_signals_delivery($1,$2,$3,$4)", [
        w,
        route.id,
        route.setup_revision,
        JSON.stringify(value),
      ]);
      await asUser(bob, "select public.accept_signals_invite($1)", [token]);
      const accepted = (
        await asUser<{
          user_id: string;
          profile_ids: string[];
          setup_revision: number;
        }>(bob, "select * from public.delivery_rules where workspace_id=$1", [
          w,
        ])
      ).rows[0];
      assert.equal(accepted.user_id, bob);
      assert.deepEqual(accepted.profile_ids, [p]);
      await assert.rejects(
        () =>
          asUser(bob, "select public.save_signals_delivery($1,$2,$3,$4)", [
            w,
            route.id,
            accepted.setup_revision,
            JSON.stringify(value),
          ]),
        /Not allowed/,
      );
      await asUser(owner, "select public.remove_signals_recipient($1,$2,$3)", [
        w,
        route.id,
        accepted.setup_revision,
      ]);
      assert.equal(
        (await asUser(bob, "select id from public.workspaces where id=$1", [w]))
          .rows.length,
        0,
      );
      await asUser(
        owner,
        "select public.restore_signals_recipient($1,$2,$3,$4)",
        [w, route.id, accepted.setup_revision + 1, JSON.stringify(value)],
      );
      assert.equal(
        (await asUser(bob, "select id from public.workspaces where id=$1", [w]))
          .rows.length,
        1,
      );
      const voice = (
        await db.query<{ setup_revision: number }>(
          "select setup_revision from public.voice_profiles where workspace_id=$1",
          [w],
        )
      ).rows[0];
      const v = {
        examples_text: "One\n---\nTwo\n---\nThree",
        tone: "Warm",
        sign_off: "Bob",
        banned_phrases: ["synergy"],
        channels: ["linkedin"],
        linkedin_length: 200,
      };
      await asUser(owner, "select public.save_signals_voice($1,$2,$3)", [
        w,
        voice.setup_revision,
        JSON.stringify(v),
      ]);
      await assert.rejects(
        () =>
          asUser(owner, "select public.save_signals_voice($1,$2,$3)", [
            w,
            voice.setup_revision,
            JSON.stringify(v),
          ]),
        /changed elsewhere/,
      );
      await assert.rejects(
        () =>
          asUser(bob, "select public.save_signals_voice($1,1,$2)", [
            w,
            JSON.stringify(v),
          ]),
        /Not allowed/,
      );
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017134828_signals_phase_six.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Phase 6 collections enforce budgets, platform access, exclusive claims and recorded charges",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Collection test','Europe/London') as id",
      );
      await adminScalar("select public.create_signals_profile($1) as id", [w]);
      const jobs = [
        {
          key: "news:0",
          source_key: "news_search",
          family: "web_search",
          provider: "treg_anyapi_news",
          cap_usd: 0.002,
          adapter: "treg_news",
        },
      ];
      const args = [
        w,
        "one",
        JSON.stringify({ fx: 0.8 }),
        JSON.stringify(jobs),
        "manual",
      ];
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.start_signals_collection($1,$2,$3,$4,$5)",
            args,
          ),
        /Budget paused/,
      );
      const today = (
        await db.query<{ today: string }>("select current_date::text as today")
      ).rows[0].today;
      await asUser(
        owner,
        "select public.change_signals_budget($1,'create',1,$2::date,($2::date+30),'Collection test',false)",
        [w, today],
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "select public.start_signals_collection($1,$2,$3,$4,$5)",
            args,
          ),
        /Not allowed/,
      );
      const id = await adminScalar(
        "select public.start_signals_collection($1,$2,$3,$4,$5) as id",
        args,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.start_signals_collection($1,'two',$2,$3,'manual')",
            [w, args[2], args[3]],
          ),
        /already in progress/,
      );
      const task = (
        await db.query<{ id: string }>(
          "select id from public.source_tasks where run_id=$1",
          [id],
        )
      ).rows[0].id;
      const service = async (sql: string, params: unknown[] = []) =>
        db.transaction(async (tx) => {
          await tx.exec("set local role service_role");
          await tx.query("select set_config('request.jwt.claims',$1,true)", [
            JSON.stringify({ role: "service_role" }),
          ]);
          return tx.query<any>(sql, params);
        });
      await service("select public.claim_signals_collection_task($1,0.8)", [
        task,
      ]);
      assert.equal(
        (
          await service(
            "select public.claim_signals_collection_task($1,0.8) as claimed",
            [task],
          )
        ).rows[0].claimed,
        null,
      );
      await service(
        "select public.finish_signals_collection_task($1,0.0008,0.001,'reported',$2,null,'receipt')",
        [task, JSON.stringify({ items: 2, fresh: 1, drops: { too_old: 1 } })],
      );
      await service(
        "select public.finish_signals_collection_task($1,0.0008,0.001,'reported',$2,null,'receipt')",
        [task, JSON.stringify({ items: 2, fresh: 1 })],
      );
      assert.equal(
        (
          await db.query("select * from public.cost_ledger where run_id=$1", [
            id,
          ])
        ).rows.length,
        1,
      );
      const costly = (
        await db.query<{ id: string }>(
          "insert into public.source_tasks(workspace_id,run_id,task_key,source_family,provider_key,collection_source_key,input,estimated_cost_usd) values($1,$2,'too-costly','web_search','treg_anyapi_news','news_search','{}',2) returning id",
          [w, id],
        )
      ).rows[0].id;
      assert.equal(
        (
          await service(
            "select public.claim_signals_collection_task($1,0.8) as claimed",
            [costly],
          )
        ).rows[0].claimed,
        null,
      );
      const skipped = (
        await db.query<{ status: string; error_code: string }>(
          "select status,error_code from public.source_tasks where id=$1",
          [costly],
        )
      ).rows[0];
      assert.equal(skipped.status, "cancelled");
      assert.equal(skipped.error_code, "budget_paused");

      assert.equal(
        (
          await asUser(
            alice,
            "select * from public.collection_runs where workspace_id=$1",
            [w],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          asUser(owner, "select public.claim_signals_collection_task($1,0.8)", [
            task,
          ]),
        /permission denied/,
      );
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017135020_signals_collection_worker_keys.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Only service credentials can authenticate an internal collection worker",
    async () => {
      await assert.rejects(
        () => asUser(owner, "select public.signals_collection_worker_access()"),
        /permission denied/,
      );
      const result = await service<{ allowed: boolean }>(
        "select public.signals_collection_worker_access() as allowed",
      );
      assert.equal(result.rows[0].allowed, true);
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017163607_signals_delivery_defaults.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Client-wide delivery limits inherit, keep individual overrides and reject stale edits",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('Delivery defaults','Europe/London') as id",
      );
      const invite = await adminScalar(
        "select public.create_signals_invite($1,'alice@example.test','client_user',$2) as id",
        [w, "8".repeat(64)],
      );
      const id = (
        await db.query<{ id: string }>(
          "select id from public.delivery_rules where invite_id=$1",
          [invite],
        )
      ).rows[0].id;
      await asUser(
        owner,
        "select public.save_signals_delivery_limits($1,0,15,45)",
        [w],
      );
      let row = (
        await db.query<any>("select * from public.delivery_rules where id=$1", [
          id,
        ])
      ).rows[0];
      assert.equal(row.max_cards_per_day, 15);
      assert.equal(row.no_repeat_days, 45);
      assert.equal(row.max_cards_override, null);
      await asUser(owner, "select public.save_signals_delivery($1,$2,$3,$4)", [
        w,
        id,
        row.setup_revision,
        JSON.stringify({
          role: "client_user",
          profile_ids: [],
          max_cards_override: 5,
          repeat_days_override: null,
        }),
      ]);
      await asUser(
        owner,
        "select public.save_signals_delivery_limits($1,1,20,60)",
        [w],
      );
      row = (
        await db.query<any>("select * from public.delivery_rules where id=$1", [
          id,
        ])
      ).rows[0];
      assert.equal(row.max_cards_per_day, 5);
      assert.equal(row.no_repeat_days, 60);
      assert.equal(row.max_cards_override, 5);
      assert.equal(row.repeat_days_override, null);
      const next = await adminScalar(
        "select public.create_signals_invite($1,'new@example.test','client_user',$2) as id",
        [w, "7".repeat(64)],
      );
      const inherited = (
        await db.query<any>(
          "select * from public.delivery_rules where invite_id=$1",
          [next],
        )
      ).rows[0];
      assert.equal(inherited.max_cards_per_day, 20);
      assert.equal(inherited.no_repeat_days, 60);
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.save_signals_delivery_limits($1,1,10,30)",
            [w],
          ),
        /changed elsewhere/,
      );
      await assert.rejects(
        () =>
          asUser(
            alice,
            "select public.save_signals_delivery_limits($1,2,10,30)",
            [w],
          ),
        /Not allowed/,
      );
    },
  );
  await db.exec(
    await readFile(
      resolve(migrations, "20261017170906_signals_phase_seven.sql"),
      "utf8",
    ),
  );
  await t.test(
    "Phase 7 pipeline data and model pricing stay isolated from client roles",
    async () => {
      assert.equal(
        (await asUser(alice, "select * from public.pipeline_runs")).rows.length,
        0,
      );
      assert.equal(
        (await asUser(alice, "select * from public.message_drafts")).rows
          .length,
        0,
      );
      const rows = await db.query<{ currency: string }>(
        "select currency from public.provider_pricing where pricing_key='anthropic/claude-haiku-5-5'",
      );
      assert.ok(rows.rows.length > 0);
      assert.ok(rows.rows.every((r) => r.currency === "USD"));
      await assert.rejects(
        () => asUser(alice, "select public.signals_pipeline_setup($1)", [a]),
        /Not allowed/,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.publish_signals_cards(gen_random_uuid(),current_date)",
          ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "AI reservations settle failed token limits once and accept only the first successful result",
    async () => {
      const w = await adminScalar(
        "select public.create_signals_client('AI accounting test','Europe/London') as id",
      );
      await adminScalar("select public.create_signals_profile($1) as id", [w]);
      await asUser(
        owner,
        "select public.change_signals_budget($1,'create',1,current_date,current_date+30,'AI test',false)",
        [w],
      );
      const run = await adminScalar(
        "select public.start_signals_collection($1,'pipeline-test','{}',$2,'test') as id",
        [
          w,
          JSON.stringify([
            {
              key: "rss",
              source_key: "trade_press",
              family: "publication",
              provider: "rss",
              cap_usd: 0,
            },
          ]),
        ],
      );
      const task = (
        await db.query<any>(
          "select id from public.source_tasks where run_id=$1",
          [run],
        )
      ).rows[0].id;
      const item = (
        await db.query<any>(
          "insert into public.collection_items(workspace_id,run_id,source_task_id,item_index,source_key,item) values($1,$2,$3,0,'trade_press','{}') returning id",
          [w, run, task],
        )
      ).rows[0].id;
      await db.query(
        "insert into public.pipeline_runs(id,workspace_id,status,snapshot,fingerprint,fallback_at) values($1,$2,'triage','{}','test',now()-interval '1 minute')",
        [run, w],
      );
      const job = (
        await db.query<any>(
          "insert into public.pipeline_jobs(workspace_id,run_id,item_id,stage) values($1,$2,$3,'triage') returning id",
          [w, run, item],
        )
      ).rows[0].id;
      const call = crypto.randomUUID(),
        second = crypto.randomUUID();
      const args = [
        job,
        call,
        "batch",
        JSON.stringify({ model: "claude-haiku-5-5" }),
        "{}",
        1,
        0.01,
        null,
      ];
      await service(
        "select public.reserve_signals_ai_call($1,$2,$3,$4,$5,$6,$7,$8)",
        args,
      );
      assert.equal(
        (
          await service<any>(
            "select public.reserve_signals_ai_call($1,$2,$3,$4,$5,$6,$7,$8) as id",
            [job, second, ...args.slice(2)],
          )
        ).rows[0].id,
        null,
      );
      const settle = [
        call,
        0.004,
        JSON.stringify({ input_tokens: 100, output_tokens: 300 }),
        "failed",
        "max_tokens",
        "Incomplete model response: max_tokens",
        null,
      ];
      await service(
        "select public.settle_signals_ai_call($1,$2,$3,$4,$5,$6,$7)",
        settle,
      );
      await service(
        "select public.settle_signals_ai_call($1,$2,$3,$4,$5,$6,$7)",
        settle,
      );
      assert.equal(
        (
          await db.query("select id from public.cost_ledger where run_id=$1", [
            run,
          ])
        ).rows.length,
        1,
      );
      assert.equal(
        (
          await db.query<any>(
            "select status,result from public.pipeline_jobs where id=$1",
            [job],
          )
        ).rows[0].result,
        null,
      );
      await db.query(
        "update public.pipeline_jobs set status='pending' where id=$1",
        [job],
      );
      await service(
        "select public.reserve_signals_ai_call($1,$2,'live',$3,'{}',1,0.01,null)",
        [job, second, JSON.stringify({ model: "claude-haiku-5-5" })],
      );
      await service(
        "select public.settle_signals_ai_call($1,0.003,'{}','succeeded','end_turn',null,$2)",
        [second, JSON.stringify({ reason: "First valid result" })],
      );
      assert.equal(
        (
          await db.query<any>(
            "select result from public.pipeline_jobs where id=$1",
            [job],
          )
        ).rows[0].result.reason,
        "First valid result",
      );
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int as n from public.cost_reservations where workspace_id=$1 and status='reserved'",
            [w],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        () =>
          asUser(
            owner,
            "select public.go_live_signals($1,$2,now()+interval '1 day',now()+interval '20 hours')",
            [w, run],
          ),
        /Review a fresh test/,
      );
    },
  );
  await db.close();
});
