import Link from "next/link";
import { signOut } from "@/app/actions";
export function Frame({
  children,
  admin = false,
  email,
  workspace,
  client,
  clientViewQuery = "",
  openCount,
}: {
  children: React.ReactNode;
  admin?: boolean;
  email: string;
  workspace?: string;
  client?: { id: string; name: string };
  clientViewQuery?: string;
  openCount?: number;
}) {
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href={admin ? "/clients" : "/today"}>
          prospect<span>signals</span>
          <i aria-hidden="true" />
        </Link>
        <span className="mode">
          {admin ? "Coris · Admin" : (workspace ?? "Your workspace")}
        </span>
        <form action={signOut}>
          <button className="text-button">Sign out</button>
        </form>
      </header>
      <div className="app-layout">
        <aside>
          <p className="eyebrow">Workspace</p>
          <nav aria-label="Main navigation">
            {admin ? (
              <>
                <Link href="/clients">
                  Clients <span>↗</span>
                </Link>
                {client && (
                  <>
                    <Link href={"/clients/" + client.id}>{client.name}</Link>
                    <Link href={"/clients/" + client.id + "/setup"}>Setup</Link>
                  </>
                )}
                <Link href="/runs">Runs and costs</Link>
                <Link href="/budgets">Budgets</Link>
              </>
            ) : (
              <>
                <Link
                  href={
                    "/today" + (clientViewQuery ? "?" + clientViewQuery : "")
                  }
                >
                  Today <span>{openCount ?? "↗"}</span>
                </Link>
                <Link
                  href={
                    "/history" + (clientViewQuery ? "?" + clientViewQuery : "")
                  }
                >
                  Sent and history
                </Link>
              </>
            )}
          </nav>
          <div className="sidebar-footer">
            <span className="status-dot" />
            Outreach stays human<p>{email}</p>
          </div>
        </aside>
        <main id="main-content">{children}</main>
      </div>
    </>
  );
}
