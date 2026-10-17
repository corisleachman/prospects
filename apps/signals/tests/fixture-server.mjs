import http from "node:http";
import { randomUUID } from "node:crypto";
const owner = "00000000-0000-0000-0000-000000000001",
  client = "00000000-0000-0000-0000-000000000002",
  invited = "00000000-0000-0000-0000-000000000003";
const workspace = "10000000-0000-0000-0000-000000000001";
const clients = [
  {
    id: workspace,
    name: "Before: Work (test)",
    status: "setup",
    timezone: "Europe/London",
    is_legacy_default: false,
    is_signals_client: true,
    logo_url: "",
    profile_limit: 5,
    setup_revision: 0,
    created_at: new Date().toISOString(),
  },
];
const previews = [];
const watches = [];
const profiles = [];
const budgets = [],
  budgetHistory = [],
  ledger = [],
  budgetAlerts = [];
let accepted = false;
const used = new Set();
function user(role) {
  return {
    id:
      role === "admin"
        ? owner
        : role === "invited"
          ? invited
          : role === "manager"
            ? "00000000-0000-0000-0000-000000000004"
            : client,
    aud: "authenticated",
    role: "authenticated",
    email:
      role === "admin"
        ? "coris@example.test"
        : role === "invited"
          ? "invited@example.test"
          : role === "manager"
            ? "manager@example.test"
            : "client@example.test",
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email" },
    user_metadata: { role: "super_admin" },
    identities: [],
  };
}
function token(role) {
  return [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user(role).id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
        aud: "authenticated",
        test_role: role,
      }),
    ).toString("base64url"),
    "fixture-signature",
  ].join(".");
}
function session(role) {
  return {
    access_token: token(role),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "fixture-refresh-" + role,
    user: user(role),
  };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  let role = "";
  try {
    role =
      JSON.parse(
        Buffer.from(
          (req.headers.authorization ?? "")
            .replace("Bearer ", "")
            .split(".")[1],
          "base64url",
        ).toString(),
      ).test_role ?? "";
  } catch {}
  if (req.headers.authorization === "Bearer fixture-service-key")
    role = "admin";
  function reply(value, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(value));
  }
  function rows(data) {
    reply(
      req.headers.accept?.includes("vnd.pgrst.object")
        ? (data[0] ?? null)
        : data,
    );
  }
  if (url.pathname === "/health") return reply({ ok: true });
  if (url.pathname === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "refresh_token")
      return reply(session(body.refresh_token.replace("fixture-refresh-", "")));
    if (body.password !== "correct-password-123")
      return reply(
        { code: "invalid_credentials", msg: "Invalid credentials" },
        400,
      );
    return reply(
      session(
        body.email === "coris@example.test"
          ? "admin"
          : body.email === "invited@example.test"
            ? "invited"
            : body.email === "manager@example.test"
              ? "manager"
              : "client",
      ),
    );
  }
  if (url.pathname === "/auth/v1/verify") {
    if (
      used.has(body.token_hash) ||
      !["fixture-invite", "fixture-recovery"].includes(body.token_hash)
    )
      return reply({ code: "otp_expired", msg: "Invalid link" }, 403);
    used.add(body.token_hash);
    return reply(session(body.type === "invite" ? "invited" : "client"));
  }
  if (url.pathname === "/auth/v1/recover") return reply({});
  if (url.pathname === "/auth/v1/logout") return reply({});
  if (url.pathname === "/auth/v1/user")
    return role
      ? reply(user(role))
      : reply({ code: "bad_jwt", msg: "Invalid token" }, 401);
  if (!role) return reply({ message: "Not authenticated" }, 401);
  if (url.pathname === "/rest/v1/platform_admins")
    return rows(role === "admin" ? [{ user_id: owner }] : []);
  if (url.pathname === "/rest/v1/workspace_members")
    return rows(
      role === "client" ||
        role === "manager" ||
        (role === "invited" && accepted)
        ? [
            {
              workspace_id: workspace,
              role: role === "manager" ? "client_admin" : "client_user",
            },
          ]
        : [],
    );
  if (url.pathname === "/rest/v1/workspaces")
    return rows(
      (role === "admin"
        ? clients
        : clients.filter((c) => c.id === workspace)
      ).filter(
        (c) =>
          !url.searchParams.has("id") ||
          (url.searchParams.get("id").startsWith("eq.")
            ? c.id === url.searchParams.get("id").slice(3)
            : url.searchParams
                .get("id")
                .slice(4, -1)
                .split(",")
                .includes(c.id)),
      ),
    );
  if (
    [
      "/rest/v1/budget_history",
      "/rest/v1/cost_ledger",
      "/rest/v1/budget_alerts",
      "/rest/v1/provider_pricing",
    ].includes(url.pathname)
  ) {
    const source = url.pathname.endsWith("budget_history")
      ? budgetHistory
      : url.pathname.endsWith("cost_ledger")
        ? ledger
        : url.pathname.endsWith("budget_alerts")
          ? budgetAlerts
          : [];
    return rows(
      role === "admin"
        ? source
            .filter(
              (x) =>
                x.workspace_id ===
                url.searchParams.get("workspace_id")?.replace("eq.", ""),
            )
            .slice()
            .reverse()
        : [],
    );
  }
  if (url.pathname === "/rest/v1/rpc/signals_budget_overview") {
    const b = budgets.find(
      (b) => b.workspace_id === body.p_workspace && b.status !== "closed",
    );
    if (role !== "admin" || !b) return reply(null);
    const spent = ledger
      .filter((l) => l.budget_id === b.id)
      .reduce((s, l) => s + l.cost, 0);
    return reply({
      budget: b,
      spent,
      reserved: 0,
      today_spent: spent,
      days_left: 30,
    });
  }
  if (url.pathname === "/rest/v1/rpc/pending_signals_budget_alerts")
    return reply([]);
  if (url.pathname === "/rest/v1/rpc/change_signals_budget") {
    if (role !== "admin") return reply({ message: "Not allowed" }, 403);
    let b = budgets.find(
      (b) => b.workspace_id === body.p_workspace && b.status !== "closed",
    );
    if (["create", "renew"].includes(body.p_action)) {
      if (b) b.status = "closed";
      b = {
        id: randomUUID(),
        workspace_id: body.p_workspace,
        amount: body.p_amount,
        period_start: body.p_start,
        period_end: body.p_end,
        note: body.p_note,
        currency: "GBP",
        status: "active",
        is_test: body.p_test,
      };
      budgets.push(b);
    } else {
      b.amount =
        body.p_action === "top_up" ? b.amount + body.p_amount : body.p_amount;
      b.status = "active";
    }
    const c = clients.find((c) => c.id === body.p_workspace);
    if (c.paused_reason?.startsWith("budget:")) {
      c.status = "setup";
      c.paused_reason = null;
    }
    budgetHistory.push({
      id: randomUUID(),
      workspace_id: b.workspace_id,
      budget_id: b.id,
      action: body.p_action,
      amount: b.amount,
      actor_label: "coris@example.test",
      note: body.p_note,
      created_at: new Date().toISOString(),
    });
    return reply(b.id);
  }
  if (url.pathname === "/rest/v1/rpc/add_signals_test_cost") {
    const b = budgets.find(
      (b) => b.workspace_id === body.p_workspace && b.status === "active",
    );
    if (role !== "admin" || !b?.is_test)
      return reply(
        { message: "Only active test budgets allow fake costs" },
        400,
      );
    const spent = ledger
      .filter((l) => l.budget_id === b.id)
      .reduce((s, l) => s + l.cost, 0);
    if (body.p_amount > b.amount - spent)
      return reply({ message: "Hard cap: insufficient budget" }, 400);
    const l = {
      id: randomUUID(),
      workspace_id: b.workspace_id,
      budget_id: b.id,
      request_key: body.p_key,
      cost: body.p_amount,
      is_test: true,
      stage: "collect",
      provider: "test",
      source_key: "manual-test",
      units: { fake_calls: 1 },
      cost_basis: "estimated",
      outcome: "success",
      created_at: new Date().toISOString(),
    };
    ledger.push(l);
    for (const threshold of [80, 100])
      if (
        spent + l.cost >= (b.amount * threshold) / 100 &&
        !budgetAlerts.some(
          (a) => a.budget_id === b.id && a.threshold === threshold,
        )
      )
        budgetAlerts.push({
          id: randomUUID(),
          workspace_id: b.workspace_id,
          budget_id: b.id,
          threshold,
          status: "pending",
          attempts: 0,
          created_at: new Date().toISOString(),
        });
    if (spent + l.cost >= b.amount) {
      b.status = "spent";
      const c = clients.find((c) => c.id === b.workspace_id);
      c.status = "paused";
      c.paused_reason =
        "budget:used up on " + new Date().toISOString().slice(0, 10);
    }
    return reply(l.id);
  }
  if (url.pathname === "/functions/v1/signals-discovery") {
    if (role !== "admin") return reply({ error: "Not allowed" }, 403);
    if (body.action === "estimate") {
      const p = profiles.find((p) => p.id === body.profile_id);
      const v = {
        id: randomUUID(),
        workspace_id: p.workspace_id,
        profile_id: p.id,
        status: "quoted",
        estimated_gbp: 0.1,
        actual_gbp: 0,
        step: 0,
        plan: { fx: 0.75, fx_date: "2026-10-16", limit: 25, profile: p },
        result: { companies: [], people: [], warnings: [] },
        created_at: new Date().toISOString(),
        saved_at: null,
        polls: 0,
      };
      previews.push(v);
      return reply(v);
    }
    const v = previews.find((v) => v.id === body.id);
    if (body.action === "start") {
      v.status = "running";
      v.result = {
        companies: Array.from({ length: 10 }, (_, i) => ({
          key: "domain:company" + i + ".test",
          name: "Company " + i + " (test)",
          website: "https://company" + i + ".test",
          linkedin_url: "https://www.linkedin.com/company/example-" + i,
          industry: "Consumer goods",
          source: "discovered",
          location: "US",
        })),
        people: Array.from({ length: 10 }, (_, i) => ({
          key: "person:" + i,
          name: "Person " + i + " (test)",
          title: "CMO",
          company_key: "domain:company" + i + ".test",
          linkedin_url: "https://www.linkedin.com/in/example-" + i,
        })),
        warnings: [],
      };
      return reply({ id: v.id, queued: true });
    }
    return reply({ queued: true });
  }
  if (url.pathname === "/rest/v1/discovery_previews") {
    const list = previews.filter(
      (v) =>
        (!url.searchParams.has("id") ||
          v.id === url.searchParams.get("id").slice(3)) &&
        (!url.searchParams.has("profile_id") ||
          v.profile_id === url.searchParams.get("profile_id").slice(3)) &&
        (!url.searchParams.has("workspace_id") ||
          v.workspace_id === url.searchParams.get("workspace_id").slice(3)),
    );
    for (const v of list)
      if (v.status === "running" && ++v.polls >= 3) {
        v.status = "succeeded";
        v.step = 2;
        v.actual_gbp = 0.075;
      }
    return rows(role === "admin" ? list.slice().reverse() : []);
  }
  if (
    url.pathname === "/rest/v1/campaign_prospects" &&
    /companies\(\*\)/.test(url.searchParams.get("select") ?? "")
  )
    return reply(
      { message: "Ambiguous company relationship", code: "PGRST201" },
      300,
    );
  if (url.pathname === "/rest/v1/campaign_prospects")
    return rows(
      role === "admin"
        ? watches.filter(
            (w) =>
              !url.searchParams.has("campaign_id") ||
              w.campaign_id === url.searchParams.get("campaign_id")?.slice(3),
          )
        : [],
    );
  if (url.pathname === "/rest/v1/discovery_refresh_log") return rows([]);
  if (url.pathname === "/rest/v1/rpc/save_signals_watchlist") {
    const v = previews.find((v) => v.id === body.p_id);
    if (role !== "admin" || !v) return reply({ message: "Not allowed" }, 403);
    for (let i = watches.length - 1; i >= 0; i--)
      if (watches[i].campaign_id === v.profile_id) watches.splice(i, 1);
    for (const c of v.result.companies.filter((c) =>
      body.p_company_keys.includes(c.key),
    ))
      watches.push({
        id: randomUUID(),
        workspace_id: v.workspace_id,
        campaign_id: v.profile_id,
        company_id: c.key,
        person_id: null,
        companies: c,
        last_refreshed_at: new Date().toISOString(),
      });
    for (const x of v.result.people.filter((x) =>
      body.p_person_keys.includes(x.key),
    ))
      watches.push({
        id: randomUUID(),
        workspace_id: v.workspace_id,
        campaign_id: v.profile_id,
        company_id: x.company_key,
        person_id: x.key,
        companies: v.result.companies.find((c) => c.key === x.company_key),
        people: x,
        last_refreshed_at: new Date().toISOString(),
      });
    v.saved_at = new Date().toISOString();
    return reply(body.p_company_keys.length);
  }
  if (url.pathname === "/rest/v1/rpc/set_signals_refresh") {
    const p = profiles.find((p) => p.id === body.p_profile);
    if (role !== "admin" || !p) return reply({ message: "Not allowed" }, 403);
    p.watch_refresh_enabled = body.p_enabled;
    return reply(null);
  }
  if (url.pathname === "/rest/v1/rpc/signals_admin_month_spend")
    return reply(
      ledger.filter((l) => !l.is_test).reduce((n, l) => n + l.cost, 0),
    );
  if (url.pathname === "/rest/v1/search_runs") return rows([]);
  if (url.pathname === "/rest/v1/campaigns")
    return rows(
      role === "admin"
        ? profiles.filter(
            (p) =>
              !url.searchParams.has("workspace_id") ||
              p.workspace_id ===
                url.searchParams.get("workspace_id")?.replace("eq.", ""),
          )
        : [],
    );
  if (url.pathname === "/rest/v1/rpc/signals_team") return reply([]);
  if (url.pathname === "/rest/v1/rpc/create_signals_profile") {
    const c = clients.find((c) => c.id === body.p_workspace_id);
    if (role !== "admin" || !c) return reply({ message: "Not allowed" }, 403);
    if (
      profiles.filter((p) => p.workspace_id === c.id).length >= c.profile_limit
    )
      return reply(
        { message: "Profile limit reached. Choose a larger placeholder plan." },
        400,
      );
    const p = {
      id: randomUUID(),
      workspace_id: c.id,
      name: "Profile " + (profiles.length + 1),
      code: String(
        profiles.filter((p) => p.workspace_id === c.id).length + 1,
      ).padStart(2, "0"),
      profile_type: "cold_outbound",
      who: "",
      criteria: {},
      priority_titles: [],
      relevant_moment: "",
      conversation_to_open: "",
      watch_list_size: 200,
      when_no_person: "needs_person",
      setup_revision: 0,
    };
    profiles.push(p);
    return reply(p.id);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_profile") {
    const p = profiles.find(
      (p) => p.id === body.p_id && p.workspace_id === body.p_workspace_id,
    );
    if (role !== "admin" || !p) return reply({ message: "Not allowed" }, 403);
    if (p.setup_revision !== body.p_revision)
      return reply(
        {
          message: "Profile changed elsewhere. Reload before saving.",
          code: "40001",
        },
        400,
      );
    Object.assign(p, body.p_profile, { setup_revision: p.setup_revision + 1 });
    return reply(p.setup_revision);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_client") {
    const c = clients.find((c) => c.id === body.p_id);
    if (role !== "admin" || !c) return reply({ message: "Not allowed" }, 403);
    if (c.setup_revision !== body.p_revision)
      return reply(
        {
          message: "Setup changed elsewhere. Reload before saving.",
          code: "40001",
        },
        400,
      );
    if (
      profiles.filter((p) => p.workspace_id === c.id).length >
      body.p_details.profile_limit
    )
      return reply(
        {
          message: "This plan has fewer profiles than the client already uses",
        },
        400,
      );
    Object.assign(c, body.p_details, { setup_revision: c.setup_revision + 1 });
    return reply(c.setup_revision);
  }
  if (url.pathname === "/rest/v1/workspace_invites") return rows([]);
  if (url.pathname === "/rest/v1/rpc/create_signals_client") {
    if (role !== "admin") return reply({ message: "Not allowed" }, 403);
    const item = {
      logo_url: "",
      profile_limit: 5,
      setup_revision: 0,
      id: randomUUID(),
      name: body.p_name,
      status: "setup",
      timezone: body.p_timezone,
      is_legacy_default: false,
      is_signals_client: true,
      created_at: new Date().toISOString(),
    };
    clients.push(item);
    return reply(item.id);
  }
  if (url.pathname === "/rest/v1/rpc/preview_signals_invite")
    return reply(
      role === "invited" && !accepted
        ? [
            {
              workspace_id: workspace,
              workspace_name: "Before: Work (test)",
              invite_role: "client_user",
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
          ]
        : [],
    );
  if (url.pathname === "/rest/v1/rpc/accept_signals_invite") {
    if (role !== "invited" || accepted)
      return reply({ message: "Invitation unavailable" }, 403);
    accepted = true;
    return reply(workspace);
  }
  return reply({ message: "Not found" }, 404);
});
server.listen(54329, "127.0.0.1", () =>
  console.log(
    "Local Supabase contract fixture ready. No external services contacted.",
  ),
);
