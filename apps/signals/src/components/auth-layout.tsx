import Link from "next/link";
export function AuthLayout({
  children,
  title,
  kicker = "Your next good conversation",
}: {
  children: React.ReactNode;
  title: string;
  kicker?: string;
}) {
  return (
    <main id="main-content" className="auth-layout">
      <section className="auth-story">
        <Link className="wordmark light" href="/">
          prospect<span>signals</span>
          <i aria-hidden="true" />
        </Link>
        <div>
          <p className="eyebrow">{kicker}</p>
          <h1>
            Good timing.
            <br />
            <em>Real reasons.</em>
          </h1>
          <p className="story-copy">
            A clear view of who’s doing something worth noticing. You decide
            when to connect.
          </p>
        </div>
        <p className="story-foot">Fresh evidence. Your judgement.</p>
      </section>
      <section className="auth-form">
        <div className="form-inner">
          <p className="eyebrow">Prospect Signals</p>
          <h2>{title}</h2>
          {children}
        </div>
        <p className="auth-foot">Nothing is sent on your behalf.</p>
      </section>
    </main>
  );
}
