import { cardContext } from "@/lib/cards";
export async function GET(request: Request) {
  const url = new URL(request.url),
    ctx = await cardContext(Object.fromEntries(url.searchParams), true);
  if (!ctx.data.can_export) return new Response("Not allowed", { status: 403 });
  const from = url.searchParams.get("from") ?? "",
    to = url.searchParams.get("to") ?? "";
  if ([from, to].some((s) => s && !/^\d{4}-\d{2}-\d{2}$/.test(s)))
    return new Response("Invalid date", { status: 400 });
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows = ctx.data.cards
    .filter(
      (c: any) => (!from || c.local_day >= from) && (!to || c.local_day <= to),
    )
    .map((c: any) => {
      const draft = c.drafts?.find((d: any) => d.id === c.sent_draft_id);
      return [
        c.local_day,
        c.person_name,
        c.company_name,
        c.profile_code,
        c.factual_summary,
        c.state,
        c.feedback?.reason,
        draft?.channel,
        draft?.version,
        draft?.subject,
        draft?.body,
        c.sent_at,
        c.replied_at,
      ];
    });
  const csv = [
    [
      "Date",
      "Person",
      "Company",
      "Profile",
      "Signal",
      "Outcome",
      "Feedback",
      "Sent channel",
      "Sent version",
      "Subject",
      "Sent opener",
      "Sent at",
      "Replied at",
    ],
    ...rows,
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=signals-history.csv",
      "Cache-Control": "no-store",
    },
  });
}
