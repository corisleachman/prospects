import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Recipient,
  SignalRule,
  SourceSetting,
  ExtraSource,
  Voice,
} from "./setup";
export async function setupData(db: SupabaseClient, workspace: string) {
  const [rules, scopes, sources, extra, voice, delivery, team, invites] =
    await Promise.all([
      db
        .from("signal_definitions")
        .select("*")
        .eq("workspace_id", workspace)
        .is("deleted_at", null)
        .order("created_at"),
      db
        .from("campaign_signal_rules")
        .select("signal_definition_id,campaign_id")
        .eq("workspace_id", workspace),
      db
        .from("workspace_source_settings")
        .select("*")
        .eq("workspace_id", workspace)
        .order("source_key"),
      db
        .from("client_extra_sources")
        .select("*")
        .eq("workspace_id", workspace)
        .is("deleted_at", null)
        .order("created_at"),
      db
        .from("voice_profiles")
        .select("*")
        .eq("workspace_id", workspace)
        .is("user_id", null)
        .single(),
      db
        .from("delivery_rules")
        .select("*")
        .eq("workspace_id", workspace)
        .eq("enabled", true),
      db.rpc("signals_team", { p_workspace_id: workspace }),
      db
        .from("workspace_invites")
        .select(
          "id,email,role,display_name,expires_at,accepted_at,revoked_at,delivery_status",
        )
        .eq("workspace_id", workspace),
    ]);
  if (
    [rules, scopes, sources, extra, voice, delivery, team, invites].some(
      (r) => r.error,
    )
  )
    throw new Error("Setup settings unavailable");
  const people: Recipient[] = [];
  for (const r of delivery.data ?? []) {
    if (r.user_id) {
      const member = team.data?.find(
        (m: any) => m.user_id === r.user_id && m.status === "active",
      );
      if (member)
        people.push({
          ...r,
          display_name: member.display_name,
          email: member.email,
          role: member.role,
          pending: false,
          morning_email_time: r.morning_email_time?.slice(0, 5) ?? null,
        });
    } else {
      const i = invites.data?.find(
        (i: any) =>
          i.id === r.invite_id &&
          !i.accepted_at &&
          !i.revoked_at &&
          i.delivery_status === "sent" &&
          new Date(i.expires_at) > new Date(),
      );
      if (i)
        people.push({
          ...r,
          display_name: i.display_name,
          email: i.email,
          role: i.role,
          pending: true,
          morning_email_time: r.morning_email_time?.slice(0, 5) ?? null,
        });
    }
  }
  return {
    rules: (rules.data ?? []).map((r) => ({
      ...r,
      profile_ids: (scopes.data ?? [])
        .filter((s) => s.signal_definition_id === r.id)
        .map((s) => s.campaign_id),
    })) as SignalRule[],
    sources: sources.data as SourceSetting[],
    extra: extra.data as ExtraSource[],
    voice: voice.data as Voice,
    recipients: people,
  };
}
