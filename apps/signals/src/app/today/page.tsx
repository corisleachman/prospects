import Link from "next/link";
import { cardContext } from "@/lib/cards";
import { Frame } from "@/components/frame";
import { Cards } from "./cards";
export default async function Today({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string;
    viewAs?: string;
    show?: string;
    recipient?: string;
  }>;
}) {
  const q = await searchParams,
    ctx = await cardContext(q),
    w = ctx.workspace,
    base = "workspace=" + w.id + (ctx.viewing ? "&viewAs=1" : ""),
    date = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: w.timezone,
    }).format(new Date());
  return (
    <Frame
      admin={false}
      email={ctx.user.email ?? ""}
      workspace={w.name}
      clientViewQuery={base}
      openCount={ctx.data.cards?.length ?? 0}
    >
      {ctx.viewing && (
        <p className="viewing-bar">
          Viewing as {w.name}. <Link href={"/clients/" + w.id}>Exit</Link>
        </p>
      )}
      <div className="screen-head">
        <div>
          <h1>Today</h1>
          <p className="muted">
            {date} ·{" "}
            {
              new Set(
                ctx.data.cards?.map(
                  (c: any) => c.person_name ?? c.company_name,
                ),
              ).size
            }{" "}
            people worth reaching out to
          </p>
        </div>
        {ctx.data.can_everyone && (
          <nav className="profile-tabs" aria-label="Show cards">
            <Link
              href={"/today?" + base + "&show=mine"}
              aria-current={
                q.show === "mine" || (q.show !== "everyone" && !ctx.viewing)
                  ? "page"
                  : undefined
              }
            >
              Mine
            </Link>
            <Link
              href={"/today?" + base + "&show=everyone"}
              aria-current={
                q.show === "everyone" || (ctx.viewing && q.show !== "mine")
                  ? "page"
                  : undefined
              }
            >
              Everyone
            </Link>
          </nav>
        )}
      </div>
      {w.status === "paused" && (
        <p className="notice">Paused until your budget renews</p>
      )}
      <Cards
        data={ctx.data}
        nextTime={ctx.data.next_time?.slice(0, 5) ?? "07:30"}
      />
    </Frame>
  );
}
