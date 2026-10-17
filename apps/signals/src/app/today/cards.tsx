"use client";
import { useState } from "react";
import { SignalCard } from "@/components/signal-card";
export function Cards({ data, nextTime }: { data: any; nextTime: string }) {
  const [profile, setProfile] = useState("all"),
    [type, setType] = useState("all"),
    [hidden, setHidden] = useState<string[]>([]),
    [notice, setNotice] = useState("");
  const all = (data.cards ?? []).filter((c: any) => !hidden.includes(c.id)),
    ordinary = all.some(
      (c: any) =>
        !c.sensitive && (profile === "all" || c.profile_id === profile),
    ),
    cards = all.filter(
      (c: any) =>
        (profile === "all" || c.profile_id === profile) &&
        (type === "all" ||
          (type === "sensitive" ? c.sensitive : c.polarity === "positive")) &&
        (type === "sensitive" || !c.sensitive || ordinary),
    );
  return (
    <div className="today-grid">
      <div
        className="card-filters"
        role="complementary"
        aria-label="Card filters"
      >
        <h2>Profiles</h2>
        <button
          aria-pressed={profile === "all"}
          onClick={() => setProfile("all")}
        >
          All
        </button>
        {data.profiles?.map((p: any) => (
          <button
            key={p.id}
            aria-pressed={profile === p.id}
            onClick={() => setProfile(p.id)}
            title={p.name}
          >
            {p.code}
          </button>
        ))}
        <h2>Type</h2>
        {["all", "positive", "sensitive"].map((t) => (
          <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <p className="weekly-sent">
          This week: {data.sent_week ?? 0} marked sent
        </p>
      </div>
      <div>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {cards.map((c: any) => (
          <SignalCard
            key={c.id}
            card={c}
            budgetAvailable={data.budget_available}
            onHandled={(id) => {
              setHidden((previous) => [...previous, id]);
              setNotice(
                "Card moved to history. They won't reappear before " +
                  c.no_repeat_until,
              );
            }}
          />
        ))}
        {!cards.length && (
          <section className="today-empty">
            <p className="eyebrow">
              {hidden.length ? "All caught up" : "No cards yet"}
            </p>
            <h2>
              {hidden.length
                ? "You're all caught up."
                : "A good reason is worth waiting for."}
            </h2>
            <p>
              {hidden.length
                ? "Next list tomorrow at " +
                  nextTime +
                  ". The system never pads the list with weak or old signals."
                : "Nothing strong enough today. We only show fresh, relevant signals."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
