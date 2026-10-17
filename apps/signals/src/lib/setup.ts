export type SetupProfile = { id: string; code: string; name: string };
export type SignalRule = {
  id: string;
  label: string;
  description: string;
  polarity: "positive" | "negative" | "neutral";
  tone_guidance: string;
  keywords: string[];
  is_active: boolean;
  applies_to_all: boolean;
  profile_ids: string[];
  setup_revision: number;
};
export type SourceSetting = {
  source_key: string;
  enabled: boolean;
  freshness_hours: number;
  setup_revision: number;
  config: { name: string; description: string };
};
export type ExtraSource = {
  id: string;
  url: string;
  validation_status: string;
  detected_feed: string | null;
  last_error: string | null;
  setup_revision: number;
};
export type Voice = {
  id: string;
  examples_text: string;
  tone: string;
  sign_off: string;
  banned_phrases: string[];
  channels: string[];
  linkedin_length: number;
  setup_revision: number;
};
export type Recipient = {
  id: string;
  user_id: string | null;
  invite_id: string | null;
  display_name: string;
  email: string;
  role: string;
  profile_ids: string[];
  max_cards_per_day: number;
  max_cards_override: number | null;
  repeat_days_override: number | null;
  no_repeat_days: number;
  morning_email_time: string | null;
  setup_revision: number;
  pending: boolean;
};
export function splitChips(text: string) {
  const out: string[] = [];
  let part = "",
    quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === "\n") && !quoted) {
      if (part.trim()) out.push(part.trim());
      part = "";
    } else part += ch;
  }
  if (part.trim()) out.push(part.trim());
  return out;
}
export function keywordParts(value: string) {
  const excluded = value.startsWith("-"),
    text = excluded ? value.slice(1) : value;
  const exact = text.startsWith('"') && text.endsWith('"') && text.length > 2;
  return { excluded, exact, text: exact ? text.slice(1, -1) : text };
}
export function examples(text: string) {
  return text
    .split(/^\s*---\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type DeliveryLimits = {
  daily: number;
  repeat: number;
  revision: number;
};
