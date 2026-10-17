"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { amount } from "@/lib/budget";
import { sendBudgetAlert } from "@/lib/mail";
async function deliver(workspace: string) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("pending_signals_budget_alerts", {
    p_workspace: workspace,
  });
  if (error) return false;
  let ok = true;
  for (const a of data ?? []) {
    let sent = false;
    try {
      await sendBudgetAlert(a);
      sent = true;
    } catch {
      ok = false;
    }
    const { error: markError } = await db.rpc("mark_signals_budget_alert", {
      p_id: a.id,
      p_sent: sent,
    });
    if (markError) ok = false;
  }
  return ok;
}
function finish(workspace: string, error?: string) {
  revalidatePath("/clients");
  revalidatePath("/clients/" + workspace + "/budget");
  redirect(
    "/clients/" +
      workspace +
      "/budget" +
      (error ? "?error=" + encodeURIComponent(error) : "?saved=1"),
  );
}
export async function changeBudget(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace"));
  let n;
  try {
    n = amount(form.get("amount"));
  } catch (e) {
    finish(workspace, (e as Error).message);
  }
  const { error } = await db.rpc("change_signals_budget", {
    p_workspace: workspace,
    p_action: String(form.get("action")),
    p_amount: n,
    p_start: form.get("start") || null,
    p_end: form.get("end") || null,
    p_note: String(form.get("note") ?? ""),
    p_test: form.get("test") === "on",
  });
  if (error) finish(workspace, error.message);
  const sent = await deliver(workspace);
  finish(
    workspace,
    sent ? undefined : "Budget saved. Alert delivery failed; use Retry alerts.",
  );
}
export async function testCost(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace"));
  let n;
  try {
    n = amount(form.get("amount"));
  } catch (e) {
    finish(workspace, (e as Error).message);
  }
  const { error } = await db.rpc("add_signals_test_cost", {
    p_workspace: workspace,
    p_amount: n,
    p_key: String(form.get("request_key") ?? randomUUID()),
  });
  if (error) finish(workspace, error.message);
  const sent = await deliver(workspace);
  finish(
    workspace,
    sent
      ? undefined
      : "Cost recorded. Alert delivery failed; use Retry alerts.",
  );
}
export async function retryAlerts(form: FormData) {
  const workspace = String(form.get("workspace"));
  const ok = await deliver(workspace);
  finish(
    workspace,
    ok
      ? undefined
      : "Alert delivery failed. Check the sender and Resend settings.",
  );
}
export async function savePricing(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace"));
  let rates;
  try {
    rates = JSON.parse(String(form.get("rates")));
    if (!rates || Array.isArray(rates) || typeof rates !== "object")
      throw new Error();
  } catch {
    finish(workspace, "Enter a JSON object for rates.");
  }
  const { error } = await db.rpc("save_signals_pricing_currency", {
    p_workspace: workspace,
    p_key: String(form.get("key")),
    p_rates: rates,
    p_currency: String(form.get("currency") ?? "GBP"),
    p_source: String(form.get("source") ?? ""),
    p_verified: String(form.get("verified") ?? "") || null,
  });
  finish(workspace, error?.message);
}
