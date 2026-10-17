"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { serviceClient } from "@/lib/supabase/server";
import { checkSource, publicSourceURL } from "@/lib/source-check";
import type {
  SignalRule,
  Voice,
  Recipient,
  SourceSetting,
  ExtraSource,
} from "@/lib/setup";
async function change(name: string, args: Record<string, unknown>) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  revalidatePath("/clients/" + args.p_workspace + "/setup");
  return data;
}
export async function saveRule(workspace: string, rule: SignalRule) {
  return change("save_signals_rule", {
    p_workspace: workspace,
    p_id: rule.id || null,
    p_revision: rule.setup_revision,
    p_value: rule,
  });
}
export async function deleteRule(workspace: string, rule: SignalRule) {
  await change("delete_signals_rule", {
    p_workspace: workspace,
    p_id: rule.id,
    p_revision: rule.setup_revision,
  });
}
export async function saveSource(
  workspace: string,
  s: SourceSetting,
  revision: number,
) {
  const r = await change("save_signals_source", {
    p_workspace: workspace,
    p_key: s.source_key,
    p_revision: revision,
    p_enabled: s.enabled,
    p_hours: s.freshness_hours,
  });
  return { revision: r.setup_revision };
}
export async function saveVoice(workspace: string, v: Voice, revision: number) {
  try {
    const data = await change("save_signals_voice", {
      p_workspace: workspace,
      p_revision: revision,
      p_value: v,
    });
    return { revision: data };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function saveRecipient(
  workspace: string,
  v: Recipient,
  revision: number,
) {
  try {
    const r = await change("save_signals_delivery", {
      p_workspace: workspace,
      p_id: v.id,
      p_revision: revision,
      p_value: v,
    });
    return { revision: r.setup_revision };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function removeRecipient(
  workspace: string,
  id: string,
  revision: number,
) {
  await change("remove_signals_recipient", {
    p_workspace: workspace,
    p_id: id,
    p_revision: revision,
  });
}
export async function addExtraSources(workspace: string, raw: string) {
  await requireAdmin();
  const urls = [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(publicSourceURL),
    ),
  ];
  if (!urls.length || urls.length > 10)
    throw new Error("Add between 1 and 10 public HTTPS URLs at a time.");
  const rows: ExtraSource[] = [];
  for (const url of urls)
    rows.push(
      await change("save_signals_extra_source", {
        p_workspace: workspace,
        p_id: null,
        p_revision: 0,
        p_url: url,
      }),
    );
  return rows;
}
export async function editExtraSource(
  workspace: string,
  row: ExtraSource,
  url: string,
) {
  return change("save_signals_extra_source", {
    p_workspace: workspace,
    p_id: row.id,
    p_revision: row.setup_revision,
    p_url: publicSourceURL(url),
  });
}
export async function deleteExtraSource(workspace: string, row: ExtraSource) {
  await change("delete_signals_extra_source", {
    p_workspace: workspace,
    p_id: row.id,
    p_revision: row.setup_revision,
  });
}
export async function validateExtraSource(workspace: string, id: string) {
  const { db } = await requireAdmin();
  const { data: row, error } = await db
    .from("client_extra_sources")
    .select("*")
    .eq("workspace_id", workspace)
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error("Source unavailable");
  const result = await checkSource(row.url);
  const { data, error: update } = await serviceClient()
    .from("client_extra_sources")
    .update({ ...result, checked_at: new Date().toISOString() })
    .eq("workspace_id", workspace)
    .eq("id", id)
    .eq("setup_revision", row.setup_revision)
    .is("deleted_at", null)
    .select()
    .single();
  if (update) throw new Error("Source changed while being checked. Try again.");
  return data as ExtraSource;
}

export async function restoreRecipient(
  workspace: string,
  v: Recipient,
  revision: number,
) {
  return change("restore_signals_recipient", {
    p_workspace: workspace,
    p_id: v.id,
    p_revision: revision,
    p_value: v,
  });
}

export async function saveClientLimits(
  workspace: string,
  value: { daily: number; repeat: number },
  revision: number,
) {
  const {db}=await requireAdmin();
  if (
    !Number.isInteger(value.daily) ||
    value.daily < 1 ||
    value.daily > 100 ||
    !Number.isInteger(value.repeat) ||
    value.repeat < 1 ||
    value.repeat > 365
  )
    return { error: "Choose 1–100 cards and a repeat window of 1–365 days." };
  const { data, error } = await db.rpc("save_signals_delivery_limits", {
    p_workspace: workspace,
    p_revision: revision,
    p_daily: value.daily,
    p_repeat: value.repeat,
  });
  if (error) return { error: error.message };
  return { revision: data.revision, routes: data.routes as Recipient[] };
}
