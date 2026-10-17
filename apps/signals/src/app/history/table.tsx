"use client";
import { useState, useTransition } from "react";
import { cardAction } from "../today/actions";
export function History({ data, query }: { data: any; query: string }) {
  const [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [cards, setCards] = useState<any[]>(data.cards ?? []),
    [toast, setToast] = useState(""),
    [busy, start] = useTransition();
  const rows = cards
    .filter(
      (c) =>
        c.state !== "open" &&
        [c.person_name, c.company_name]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!from || c.local_day >= from) &&
        (!to || c.local_day <= to),
    )
    .sort((a, b) =>
      (b.sent_at ?? b.dismissed_at ?? b.created_at).localeCompare(
        a.sent_at ?? a.dismissed_at ?? a.created_at,
      ),
    );
  function act(c: any, action: string) {
    start(async () => {
      const r = await cardAction(c.id, action, c.sent_draft_id);
      if (r.error) {
        setToast(r.error);
        return;
      }
      setCards(
        cards.map((x) =>
          x.id === c.id
            ? { ...x, state: action === "restored" ? "open" : "replied" }
            : x,
        ),
      );
      setToast(action === "restored" ? "Restored to Today" : "Reply recorded");
    });
  }
  return (
    <>
      <div className="history-controls">
        <label>
          Search person or company
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {data.can_export && (
          <a
            className="button secondary"
            href={"/history/export?" + query + "&from=" + from + "&to=" + to}
          >
            Download CSV
          </a>
        )}
      </div>
      {toast && (
        <p className="notice" role="status">
          {toast}
        </p>
      )}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Signal</th>
                <th>Outcome</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.person_name ?? "Needs a person"}
                    <small>{c.company_name}</small>
                  </td>
                  <td>{c.factual_summary}</td>
                  <td>
                    <span
                      className={
                        "badge " + (c.state === "dismissed" ? "" : "positive")
                      }
                    >
                      {c.state === "dismissed"
                        ? "Not relevant · " + (c.feedback?.reason ?? "")
                        : c.state === "replied"
                          ? "Replied"
                          : "Sent"}
                    </span>
                    {c.sent_draft_id && (
                      <small>
                        Sent{" "}
                        {
                          c.drafts?.find((d: any) => d.id === c.sent_draft_id)
                            ?.channel
                        }{" "}
                        · Version{" "}
                        {
                          c.drafts?.find((d: any) => d.id === c.sent_draft_id)
                            ?.version
                        }
                      </small>
                    )}
                  </td>
                  <td>
                    {c.state === "sent" && (
                      <button
                        disabled={busy}
                        onClick={() => act(c, "marked_replied")}
                      >
                        Mark replied
                      </button>
                    )}
                    {c.state === "dismissed" && (
                      <button
                        disabled={busy}
                        onClick={() => act(c, "restored")}
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="today-empty">
          Nothing yet. Mark a card sent or not relevant on Today and it will
          show here.
        </p>
      )}
    </>
  );
}
