import Link from "next/link";
export default function NotAllowed() {
  return (
    <main id="main-content" className="standalone">
      <p className="eyebrow">Prospect Signals</p>
      <h1>Not allowed.</h1>
      <p>Your account doesn’t have access to this page.</p>
      <Link className="button" href="/today">
        Back to Today
      </Link>
    </main>
  );
}
