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
    created_at: new Date().toISOString(),
  },
];
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
      role === "admin" ? clients : clients.filter((c) => c.id === workspace),
    );
  if (url.pathname === "/rest/v1/workspace_invites") return rows([]);
  if (url.pathname === "/rest/v1/rpc/create_signals_client") {
    if (role !== "admin") return reply({ message: "Not allowed" }, 403);
    const item = {
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
