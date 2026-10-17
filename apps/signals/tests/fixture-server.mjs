import http from "node:http";
import { readFileSync } from "node:fs";
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
const pipelines = [];
let clientCards = [],
  cardEvents = [];
const collections = [],
  collectionItems = [],
  collectionTasks = [],
  collectionSearchRuns = [];
const watches = [];
const profiles = [];
const signalRules = [],
  ruleScopes = [],
  sourceSettings = [],
  extraSources = [],
  voices = [],
  deliveries = [],
  invitations = [],
  teamMembers = [];
const ruleDefaults = JSON.parse(
  readFileSync(
    new URL("../config/signal-defaults.json", import.meta.url),
    "utf8",
  ),
);
const sourceCatalog = JSON.parse(
  readFileSync(
    new URL("../config/source-catalog.json", import.meta.url),
    "utf8",
  ),
);
function seedSettings(c) {
  c.default_max_cards_per_day ??= 10;
  c.default_no_repeat_days ??= 30;
  c.delivery_limits_revision ??= 0;
  for (const d of ruleDefaults)
    signalRules.push({
      id: randomUUID(),
      workspace_id: c.id,
      label: d.label,
      description: d.description,
      polarity: d.polarity,
      tone_guidance: d.tone_guidance ?? "",
      keywords: [],
      is_active: d.enabled,
      applies_to_all: d.scope === "all",
      scope_names: d.scope_names ?? [],
      setup_revision: 0,
    });
  for (const d of sourceCatalog)
    sourceSettings.push({
      workspace_id: c.id,
      source_key: d.key,
      enabled: d.enabled,
      freshness_hours: d.freshness_hours,
      config: d,
      setup_revision: 0,
    });
  voices.push({
    id: randomUUID(),
    workspace_id: c.id,
    user_id: null,
    examples_text: "",
    tone: "",
    sign_off: "",
    banned_phrases: [],
    channels: ["email", "linkedin"],
    linkedin_length: 280,
    setup_revision: 0,
  });
}
clients.forEach(seedSettings);
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
  if (url.pathname === "/fixture/resend")
    return reply({ id: "fixture-message" });
  if (url.pathname === "/fixture/cards") {
    if (body.clear) {
      clientCards = [];
      return reply({ cleared: true });
    }
    clientCards = [0, 1, 2].map((n) => ({
      id: randomUUID(),
      card_id: randomUUID(),
      user_id: client,
      local_day: new Date().toISOString().slice(0, 10),
      position: n + 1,
      state: "open",
      no_repeat_until: "2026-11-16",
      created_at: new Date().toISOString(),
      relevance: n === 2 ? 8 : 7,
      polarity: n === 2 ? "negative" : "positive",
      sensitive: n === 2,
      fresh_until: new Date(Date.now() + 86400000).toISOString(),
      why_this_person:
        n === 2
          ? "Confirmed changes at the company; acknowledgment only."
          : "A new campaign gives a specific reason to connect.",
      profile_id: "20000000-0000-0000-0000-000000000001",
      profile_code: "01B",
      profile_name: "Established growth brands",
      company_name: n === 2 ? "Lumen (test)" : "Example Brand (test)",
      industry: "Consumer goods",
      location: "New York",
      person_name: ["Jordan Wells", "Morgan Reed", "Sam Lewis"][n],
      person_title: "VP Marketing",
      linkedin_url: "https://www.linkedin.com/in/example-person",
      recipient_name: "Jordan",
      factual_summary:
        n === 2
          ? "Lumen announced a restructure of its marketing team."
          : "Example Brand announced a major new brand campaign.",
      sources: [
        {
          name: "Trade test",
          url: "https://example.test/news",
          published_at: new Date(Date.now() - 4 * 3600000).toISOString(),
          primary: true,
        },
      ],
      drafts: [
        {
          id: randomUUID(),
          channel: "linkedin",
          body:
            n === 2
              ? "I saw the news about the restructure at Lumen. Thinking of you and the team."
              : "I saw Example Brand’s new campaign, thought it’d be good to connect.",
          version: 1,
        },
        {
          id: randomUUID(),
          channel: "email",
          subject: "Example Brand’s campaign",
          body:
            n === 2
              ? "I saw the news about Lumen. Thinking of you and the team."
              : "I saw the new campaign at Example Brand. Thought it’d be good to connect.",
          version: 1,
        },
      ],
      rewrite_counts: {},
    }));
    cardEvents = [];
    return reply({ seeded: true });
  }
  if (url.pathname === "/fixture/card-events") return reply(cardEvents);
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
  if (url.pathname === "/auth/v1/admin/generate_link")
    return reply({
      id: randomUUID(),
      email: body.email,
      hashed_token: "fixture-invite",
      action_link: "https://example.test/invite",
      verification_type: "invite",
    });
  if (url.pathname === "/rest/v1/rpc/create_signals_invite") {
    if (role !== "admin") return reply({ message: "Not allowed" }, 403);
    const id = randomUUID();
    invitations.push({
      id,
      workspace_id: body.p_workspace_id,
      email: body.p_email,
      role: body.p_role,
      display_name: "",
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      accepted_at: null,
      revoked_at: null,
      delivery_status: "pending",
    });
    deliveries.push({
      id: randomUUID(),
      workspace_id: body.p_workspace_id,
      invite_id: id,
      user_id: null,
      profile_ids: [],
      max_cards_per_day:
        clients.find((c) => c.id === body.p_workspace_id)
          ?.default_max_cards_per_day ?? 10,
      no_repeat_days:
        clients.find((c) => c.id === body.p_workspace_id)
          ?.default_no_repeat_days ?? 30,
      max_cards_override: null,
      repeat_days_override: null,
      morning_email_time: null,
      enabled: true,
      setup_revision: 0,
    });
    return reply(id);
  }
  if (url.pathname === "/rest/v1/rpc/mark_signals_invite_delivery") {
    const i = invitations.find((i) => i.id === body.p_id);
    if (i) {
      i.delivery_status = body.p_sent ? "sent" : "failed";
      if (!body.p_sent) i.revoked_at = new Date().toISOString();
    }
    return reply(null);
  }
  if (url.pathname === "/rest/v1/rpc/signals_cards")
    return reply({
      cards: clientCards.filter((c) => body.p_history || c.state === "open"),
      profiles: [
        {
          id: "20000000-0000-0000-0000-000000000001",
          code: "01B",
          name: "Established growth brands",
        },
      ],
      can_everyone: ["admin", "manager"].includes(role),
      can_export: ["admin", "manager"].includes(role),
      sent_week: clientCards.filter((c) => c.state === "sent").length,
      budget_available: true,
      next_time: "07:30",
    });
  if (url.pathname === "/rest/v1/rpc/signals_card_action") {
    const c = clientCards.find((c) => c.id === body.p_delivery);
    if (!c) return reply({ message: "Not allowed" }, 400);
    cardEvents.push(body);
    if (body.p_action === "marked_sent") {
      c.state = "sent";
      c.sent_at = new Date().toISOString();
      c.sent_draft_id = body.p_draft;
    }
    if (body.p_action === "not_relevant") {
      c.state = "dismissed";
      c.dismissed_at = new Date().toISOString();
      c.feedback = { reason: body.p_reason };
    }
    if (body.p_action === "marked_replied") c.state = "replied";
    if (body.p_action === "restored") c.state = "open";
    return reply(null);
  }
  if (url.pathname === "/functions/v1/signals-pipeline") {
    if (body.action === "rewrite") {
      const c = clientCards.find((c) => c.id === body.delivery),
        channel = body.channel;
      if (!c) return reply({ error: "Not allowed" }, 403);
      const version = c.drafts.filter((d) => d.channel === channel).length + 1;
      if (version > 4) return reply({ error: "Three rewrites used" }, 400);
      const draft = {
        id: randomUUID(),
        channel,
        subject: channel === "email" ? "A fresh subject" : null,
        body: "I noticed Example Brand’s new campaign. Thought it’d be good to connect.",
        version,
      };
      c.drafts.push(draft);
      c.rewrite_counts[channel] = (c.rewrite_counts[channel] ?? 0) + 1;
      return reply({ draft, attempted: true });
    }
    if (role !== "admin") return reply({ error: "Not allowed" }, 403);
    if (body.action === "work") return reply({ id: body.id });
    const id = randomUUID(),
      w = clients.find((c) => c.id === body.workspace_id);
    const p = {
      id,
      workspace_id: w.id,
      status: "ready",
      samples_reviewed: false,
      created_at: new Date().toISOString(),
      summary: {
        items_collected: 47,
        fresh: 12,
        usable: 0,
        cost: 0.008,
        unmatched: 8,
        below_seven: 4,
        drops: { too_old: 20, duplicate: 15 },
        stages: {
          triage: { cost: 0.002, cache_read_input_tokens: 12000 },
          score: { cost: 0.006, cache_read_input_tokens: 4000 },
        },
      },
    };
    pipelines.push(p);
    w.latest_pipeline_test_id = id;
    return reply({ id });
  }
  if (url.pathname === "/rest/v1/pipeline_runs")
    return rows(
      role === "admin"
        ? pipelines.filter(
            (p) =>
              !url.searchParams.has("id") ||
              p.id === url.searchParams.get("id").slice(3),
          )
        : [],
    );
  if (url.pathname === "/rest/v1/campaign_signals") return rows([]);
  if (url.pathname === "/rest/v1/rpc/review_signals_test") {
    const p = pipelines.find((p) => p.id === body.p_run);
    if (p) p.samples_reviewed = true;
    return reply(null);
  }
  if (url.pathname === "/rest/v1/rpc/go_live_signals")
    return reply(
      { message: "Invite an active recipient and choose their profiles first" },
      400,
    );
  if (url.pathname === "/rest/v1/collection_runs")
    return rows(role === "admin" ? collections : []);
  if (url.pathname === "/rest/v1/collection_items")
    return rows(
      role === "admin"
        ? collectionItems.filter(
            (x) =>
              !url.searchParams.has("run_id") ||
              x.run_id === url.searchParams.get("run_id").slice(3),
          )
        : [],
    );
  if (url.pathname === "/rest/v1/source_tasks")
    return rows(
      role === "admin"
        ? collectionTasks.filter(
            (x) =>
              !url.searchParams.has("run_id") ||
              x.run_id === url.searchParams.get("run_id").slice(3),
          )
        : [],
    );
  const setupTables = {
    signal_definitions: signalRules,
    campaign_signal_rules: ruleScopes,
    workspace_source_settings: sourceSettings,
    client_extra_sources: extraSources,
    voice_profiles: voices,
    delivery_rules: deliveries,
  };
  const setupTable = url.pathname.split("/").pop();
  if (url.pathname.startsWith("/rest/v1/") && setupTables[setupTable]) {
    if (role !== "admin") return rows([]);
    const matches = setupTables[setupTable].filter(
      (r) =>
        (!url.searchParams.has("workspace_id") ||
          r.workspace_id === url.searchParams.get("workspace_id").slice(3)) &&
        (!url.searchParams.has("id") ||
          r.id === url.searchParams.get("id").slice(3)) &&
        (!url.searchParams.has("invite_id") ||
          r.invite_id === url.searchParams.get("invite_id").slice(3)) &&
        (!url.searchParams.has("enabled") || r.enabled === true) &&
        !r.deleted_at,
    );
    if (req.method === "PATCH") for (const r of matches) Object.assign(r, body);
    return rows(matches);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_rule") {
    if (role !== "admin") return reply({ message: "Not allowed" }, 403);
    let r = signalRules.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (r && r.setup_revision !== body.p_revision)
      return reply({ message: "Rule changed elsewhere" }, 400);
    if (!r) {
      r = {
        id: randomUUID(),
        workspace_id: body.p_workspace,
        setup_revision: 0,
      };
      signalRules.push(r);
    }
    Object.assign(r, body.p_value, {
      id: r.id,
      setup_revision: r.setup_revision + 1,
    });
    for (let i = ruleScopes.length - 1; i >= 0; i--)
      if (ruleScopes[i].signal_definition_id === r.id) ruleScopes.splice(i, 1);
    const ids = r.applies_to_all
      ? profiles
          .filter((p) => p.workspace_id === r.workspace_id)
          .map((p) => p.id)
      : r.profile_ids;
    for (const id of ids)
      ruleScopes.push({
        workspace_id: r.workspace_id,
        signal_definition_id: r.id,
        campaign_id: id,
      });
    return reply({ ...r, profile_ids: ids });
  }
  if (url.pathname === "/rest/v1/rpc/delete_signals_rule") {
    const r = signalRules.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (r) r.deleted_at = new Date().toISOString();
    return reply(null);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_source") {
    const r = sourceSettings.find(
      (r) => r.workspace_id === body.p_workspace && r.source_key === body.p_key,
    );
    if (!r || r.setup_revision !== body.p_revision)
      return reply({ message: "Source changed elsewhere" }, 400);
    Object.assign(r, {
      enabled: body.p_enabled,
      freshness_hours: body.p_hours,
      setup_revision: r.setup_revision + 1,
    });
    return reply(r);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_voice") {
    const r = voices.find((r) => r.workspace_id === body.p_workspace);
    if (!r || r.setup_revision !== body.p_revision)
      return reply({ message: "Voice changed elsewhere" }, 400);
    Object.assign(r, body.p_value, { setup_revision: r.setup_revision + 1 });
    return reply(r.setup_revision);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_delivery_limits") {
    const c = clients.find((c) => c.id === body.p_workspace);
    if (role !== "admin" || !c) return reply({ message: "Not allowed" }, 403);
    if (c.delivery_limits_revision !== body.p_revision)
      return reply({ message: "Client limits changed elsewhere" }, 400);
    c.default_max_cards_per_day = body.p_daily;
    c.default_no_repeat_days = body.p_repeat;
    c.delivery_limits_revision++;
    const rs = deliveries.filter((r) => r.workspace_id === c.id);
    for (const row of rs) {
      row.max_cards_per_day = row.max_cards_override ?? body.p_daily;
      row.no_repeat_days = row.repeat_days_override ?? body.p_repeat;
      row.setup_revision++;
    }
    return reply({ revision: c.delivery_limits_revision, routes: rs });
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_delivery") {
    const r = deliveries.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (!r || r.setup_revision !== body.p_revision)
      return reply({ message: "Person changed elsewhere" }, 400);
    Object.assign(r, body.p_value, { setup_revision: r.setup_revision + 1 });
    const i = invitations.find((i) => i.id === r.invite_id);
    if (i)
      Object.assign(i, {
        display_name: body.p_value.display_name,
        role: body.p_value.role,
      });
    return reply(r);
  }
  if (url.pathname === "/rest/v1/rpc/remove_signals_recipient") {
    const r = deliveries.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (r) {
      r.enabled = false;
      r.setup_revision++;
      const i = invitations.find((i) => i.id === r.invite_id);
      if (i) i.revoked_at = new Date().toISOString();
    }
    return reply(null);
  }
  if (url.pathname === "/rest/v1/rpc/restore_signals_recipient") {
    const r = deliveries.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (r) {
      Object.assign(r, body.p_value, {
        enabled: true,
        setup_revision: r.setup_revision + 1,
      });
      const i = invitations.find((i) => i.id === r.invite_id);
      if (i) i.revoked_at = null;
    }
    return reply(r);
  }
  if (url.pathname === "/rest/v1/rpc/save_signals_extra_source") {
    let r = extraSources.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (!r) {
      r = {
        id: randomUUID(),
        workspace_id: body.p_workspace,
        setup_revision: 0,
      };
      extraSources.push(r);
    }
    Object.assign(r, {
      url: body.p_url,
      validation_status: "pending",
      detected_feed: null,
      last_error: null,
      setup_revision: r.setup_revision + 1,
    });
    return reply(r);
  }
  if (url.pathname === "/rest/v1/rpc/delete_signals_extra_source") {
    const r = extraSources.find(
      (r) => r.id === body.p_id && r.workspace_id === body.p_workspace,
    );
    if (r) r.deleted_at = new Date().toISOString();
    return reply(null);
  }
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
  if (url.pathname === "/rest/v1/rpc/signals_discovery_mail_config")
    return reply(null);
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
  if (url.pathname === "/functions/v1/signals-collect") {
    if (role !== "admin") return reply({ error: "Not allowed" }, 403);
    if (body.action === "work") return reply({ id: body.id });
    const id = randomUUID(),
      workspace_id = body.workspace_id;
    collectionSearchRuns.push({
      id,
      workspace_id,
      status: "succeeded",
      run_type: "manual",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    collections.push({ id, workspace_id, kind: "manual" });
    collectionTasks.push({
      id: randomUUID(),
      workspace_id,
      run_id: id,
      collection_source_key: "trade_press",
      status: "succeeded",
      collected_count: 4,
      fresh_count: 1,
      usable_count: 0,
      cost_gbp: 0,
      drop_counts: { too_old: 1, no_date: 1, duplicate: 1 },
      input: { url: "https://example.test/feed" },
      error_summary: null,
    });
    collectionItems.push({
      id: randomUUID(),
      workspace_id,
      run_id: id,
      drop_reason: null,
      company_ids: [],
      item: {
        title: "A brand launches a new creative campaign (fixture)",
        excerpt: "The brand announced a new campaign. Local test data.",
        url: "https://example.test/news",
        source_name: "Trade test",
        published_at: new Date().toISOString(),
      },
    });
    return reply({ id });
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
  if (url.pathname === "/rest/v1/search_runs")
    return rows(
      role === "admin"
        ? collectionSearchRuns.filter(
            (r) =>
              !url.searchParams.has("id") ||
              r.id === url.searchParams.get("id").slice(3),
          )
        : [],
    );
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
  if (url.pathname === "/rest/v1/rpc/signals_team")
    return reply(
      teamMembers.filter((m) => m.workspace_id === body.p_workspace_id),
    );
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
    for (const r of signalRules.filter(
      (r) => r.workspace_id === p.workspace_id && r.applies_to_all,
    ))
      ruleScopes.push({
        workspace_id: p.workspace_id,
        signal_definition_id: r.id,
        campaign_id: p.id,
      });
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
    for (const r of signalRules.filter(
      (r) =>
        r.workspace_id === p.workspace_id && r.scope_names?.includes(p.name),
    ))
      if (
        !ruleScopes.some(
          (s) => s.signal_definition_id === r.id && s.campaign_id === p.id,
        )
      )
        ruleScopes.push({
          workspace_id: p.workspace_id,
          signal_definition_id: r.id,
          campaign_id: p.id,
        });
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
  if (url.pathname === "/rest/v1/workspace_invites")
    return rows(
      invitations.filter(
        (i) =>
          i.workspace_id === url.searchParams.get("workspace_id")?.slice(3),
      ),
    );
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
    seedSettings(item);
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
