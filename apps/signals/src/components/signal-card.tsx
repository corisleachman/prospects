"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cardAction, rewriteCard, findCardPerson } from "@/app/today/actions";
export function SignalCard({
  card: c,
  budgetAvailable,
  onHandled,
  preview = false,
}: {
  card: any;
  budgetAvailable: boolean;
  onHandled: (id: string) => void;
  preview?: boolean;
}) {
  const router = useRouter();
  const [finding, setFinding] = useState(false),
    [quote, setQuote] = useState<any>(null);
  const [tab, setTab] = useState("linkedin"),
    [drafts, setDrafts] = useState<any[]>(c.drafts ?? []),
    [indices, setIndices] = useState<Record<string, number>>({
      linkedin: 0,
      email: 0,
    }),
    [toast, setToast] = useState(""),
    [feedback, setFeedback] = useState(false),
    [note, setNote] = useState(""),
    [other, setOther] = useState(false),
    [rewriting, setRewriting] = useState(false),
    [busy, start] = useTransition(),
    [counts, setCounts] = useState<Record<string, number>>(
      c.rewrite_counts ?? {},
    ),
    box = useRef<HTMLDivElement>(null);
  const choices = drafts
      .filter((d) => d.channel === tab)
      .sort((a, b) => a.version - b.version),
    index = Math.min(indices[tab] ?? 0, Math.max(0, choices.length - 1)),
    d = choices[index],
    source = c.sources?.find((s: any) => s.primary) ?? c.sources?.[0],
    age = source?.published_at
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(source.published_at)) / 3600000),
        )
      : null;
  function action(name: string, reason: string | null = null) {
    setToast("");
    start(async () => {
      const r = await cardAction(
        c.id,
        name,
        d?.id ?? null,
        reason,
        other ? note : null,
      );
      if (r.error) {
        setToast(r.error);
        return;
      }
      if (["marked_sent", "not_relevant"].includes(name)) {
        setToast(
          name === "marked_sent"
            ? "They won't reappear before " + c.no_repeat_until
            : "Feedback saved",
        );
        onHandled(c.id);
      } else setToast("Saved");
    });
  }
  async function copy() {
    const text =
      tab === "email" && d?.subject
        ? d.subject + "\n\n" + d.body
        : (d?.body ?? "");
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied");
    } catch {
      if (box.current) {
        const range = document.createRange();
        range.selectNodeContents(box.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setToast("Text selected. Copy it with your keyboard.");
    }
    const r = await cardAction(c.id, "copied", d?.id ?? null);
    if (r.error) setToast(r.error);
  }
  async function findPerson(approved = false) {
    setFinding(true);
    setToast("");
    try {
      const r = await findCardPerson(
        c.id,
        approved ? quote?.cap_gbp : undefined,
      );
      if (r.error) setToast(r.error);
      else if (r.quote) setQuote(r.quote);
      else if (r.found) {
        setQuote(null);
        setToast("Person found");
        router.refresh();
      } else setToast(r.message);
    } catch {
      setToast("Couldn't find a person, try again");
    } finally {
      setFinding(false);
    }
  }
  async function rewrite() {
    setRewriting(true);
    setToast("");
    try {
      const r = await rewriteCard(c.id, tab);
      if (r.attempted)
        setCounts({ ...counts, [tab]: Number(counts[tab] ?? 0) + 1 });
      if (r.error) {
        setToast("Couldn't rewrite, try again");
        return;
      }
      if (r.draft) {
        setDrafts([...drafts, r.draft]);
        setIndices({ ...indices, [tab]: choices.length });
      }
    } catch {
      setToast("Couldn't rewrite, try again");
    } finally {
      setRewriting(false);
    }
  }
  return (
    <article className="signal-card">
      <div className="card-person">
        <span className="avatar">
          {(c.person_name ?? c.company_name)
            .split(/\s+/)
            .slice(0, 2)
            .map((x: string) => x[0])
            .join("")}
        </span>
        <div className="card-identity">
          <h2>
            {c.person_name ?? "Needs a person"}
            <span> · {c.person_title ?? c.company_name}</span>
          </h2>
          <p>
            {[c.company_name, c.industry, c.location]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {c.recipient_name && (
            <small className="muted">For {c.recipient_name}</small>
          )}
        </div>
        <div className="card-pills">
          {preview && <span className="badge">Score {c.relevance}/10</span>}
          <span className="badge mono" title={c.profile_name}>
            {c.profile_code}
          </span>
          <span className={"badge " + (c.sensitive ? "sensitive" : "positive")}>
            {c.sensitive
              ? "Sensitive"
              : c.polarity === "neutral"
                ? "Neutral"
                : "Positive"}
          </span>
        </div>
      </div>
      <h3>What happened</h3>
      <p className="card-event">{c.factual_summary}</p>
      <p className="source-line">
        {source?.name ?? "Source"} ·{" "}
        {age === null ? "Publication date unavailable" : age + " hours ago"}{" "}
        {source && (
          <a href={source.url} target="_blank" rel="noreferrer">
            Open source ↗
          </a>
        )}{" "}
        {(c.sources?.length ?? 0) > 1 && (
          <span> · Also in {c.sources.length - 1}</span>
        )}
      </p>
      <p className="why-person">
        <strong>Why this person:</strong> {c.why_this_person}
      </p>
      <div className="opener-tabs" role="tablist" aria-label="Opener channel">
        {["linkedin", "email"].map((t) => (
          <button
            role="tab"
            aria-selected={t === tab}
            id={c.id + "-tab-" + t}
            aria-controls={c.id + "-opener"}
            tabIndex={t === tab ? 0 : -1}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "linkedin"
                    : e.key === "End"
                      ? "email"
                      : tab === "linkedin"
                        ? "email"
                        : "linkedin";
                setTab(next);
                document.getElementById(c.id + "-tab-" + next)?.focus();
              }
            }}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "linkedin" ? "LinkedIn" : "Email"}
          </button>
        ))}
        {tab === "linkedin" && <small>{d?.body?.length ?? 0} characters</small>}
      </div>
      <div
        className="copy-box"
        ref={box}
        aria-busy={rewriting}
        role="tabpanel"
        id={c.id + "-opener"}
        aria-labelledby={c.id + "-tab-" + tab}
      >
        {rewriting ? (
          <p>
            <span className="spinner" /> Writing a fresh version…
          </p>
        ) : (
          <>
            {tab === "email" && d?.subject && (
              <p>
                <strong>{d.subject}</strong>
              </p>
            )}
            <p>{d?.body ?? "No opener for this channel"}</p>
          </>
        )}
      </div>
      <div className="version-controls">
        <button
          aria-label="Previous version"
          disabled={index === 0 || rewriting}
          onClick={() => setIndices({ ...indices, [tab]: index - 1 })}
        >
          ‹
        </button>
        <span>
          Version {choices.length ? index + 1 : 0} of {choices.length}
        </span>
        <button
          aria-label="Next version"
          disabled={index >= choices.length - 1 || rewriting}
          onClick={() => setIndices({ ...indices, [tab]: index + 1 })}
        >
          ›
        </button>
      </div>
      {!preview && !c.person_name && (
        <div className="notice">
          <button
            className="button secondary"
            disabled={finding || busy}
            onClick={() => findPerson(false)}
          >
            {finding ? "Checking people…" : "Find a person"}
          </button>
          {quote && (
            <>
              <p>
                A provider search costs up to £
                {Number(quote.cap_gbp).toFixed(4)}, within your client’s budget.
              </p>
              <button disabled={finding} onClick={() => findPerson(true)}>
                Approve and search
              </button>
              <button className="text-button" onClick={() => setQuote(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {!preview && (
        <div className="card-actions">
          <button
            className="button"
            disabled={!d || busy || rewriting}
            onClick={copy}
          >
            Copy
          </button>
          {c.linkedin_url ? (
            <a
              className="button secondary"
              href={c.linkedin_url}
              target="_blank"
              rel="noreferrer"
              onClick={() => void cardAction(c.id, "opened_linkedin")}
            >
              Open LinkedIn ↗
            </a>
          ) : (
            <span className="small-note">No verified LinkedIn URL</span>
          )}
          <button
            className="button secondary"
            disabled={
              rewriting ||
              busy ||
              !budgetAvailable ||
              Number(counts[tab] ?? 0) >= 3
            }
            onClick={rewrite}
          >
            {!budgetAvailable
              ? "Budget used up for this month"
              : Number(counts[tab] ?? 0) >= 3
                ? "3 rewrites used"
                : "Rewrite"}
          </button>
          <button
            className="button secondary"
            disabled={busy || rewriting || !d || !c.person_name}
            onClick={() => action("marked_sent")}
          >
            Mark sent
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setFeedback(!feedback)}
          >
            Not relevant
          </button>
        </div>
      )}
      {feedback && (
        <div className="feedback-row">
          <p>Why isn't it relevant?</p>
          {[
            "Wrong person",
            "Wrong company",
            "Old news",
            "Weak reason",
            "Already in touch",
            "Not a real event",
            "Not our market",
          ].map((r) => (
            <button
              key={r}
              className="chip"
              disabled={busy}
              onClick={() => action("not_relevant", r)}
            >
              {r}
            </button>
          ))}
          <button className="chip" onClick={() => setOther(true)}>
            Other
          </button>
          {other && (
            <label>
              Note
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
              />
              <button
                disabled={!note.trim() || busy}
                onClick={() => action("not_relevant", "Other")}
              >
                Save feedback
              </button>
            </label>
          )}
          <button className="text-button" onClick={() => setFeedback(false)}>
            Cancel
          </button>
        </div>
      )}
      {toast && (
        <p role="status" className="notice">
          {toast}
        </p>
      )}
    </article>
  );
}
