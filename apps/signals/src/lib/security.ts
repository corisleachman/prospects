export type ClientRole = "client_admin" | "client_user";
export function clientRole(value: unknown): ClientRole {
  if (value !== "client_admin" && value !== "client_user")
    throw new Error("Choose a valid client role");
  return value;
}
export function safeNext(value: unknown, fallback = "/today") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return fallback;
  try {
    const u = new URL(value, "https://signals.invalid");
    return ["/today", "/clients", "/accept-invite", "/set-password"].includes(
      u.pathname,
    )
      ? u.pathname + u.search
      : fallback;
  } catch {
    return fallback;
  }
}
export function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function emailAddress(value: unknown) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address");
  return email;
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
