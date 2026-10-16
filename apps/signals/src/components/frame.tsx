import Link from "next/link";
import { signOut } from "@/app/actions";
export function Frame({
  children,
  admin = false,
  email,
  workspace,
}: {
  children: React.ReactNode;
  admin?: boolean;
  email: string;
  workspace?: string;
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
            {admin && (
              <Link href="/clients">
                Clients <span>↗</span>
              </Link>
            )}
            <Link href="/today">
              Today <span>↗</span>
            </Link>
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
