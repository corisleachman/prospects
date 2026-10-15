import "server-only";
import { escapeHtml } from "./security";
export async function sendInvitation(
  email: string,
  client: string,
  url: string,
  id: string,
) {
  const key = process.env.RESEND_API_KEY,
    from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error("Invitation email is unavailable");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "Idempotency-Key": "signals-invite-" + id,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Your invitation to ${client}`,
      text: `You've been invited to ${client} on Prospect Signals. Open your invitation: ${url}\nThis invitation expires in seven days. If you weren't expecting it, you can ignore this email.`,
      html: `<p>You've been invited to <strong>${escapeHtml(client)}</strong> on Prospect Signals.</p><p><a href="${escapeHtml(url)}">Open your invitation</a></p><p>This invitation expires in seven days. If you weren't expecting it, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Invitation email failed");
}
