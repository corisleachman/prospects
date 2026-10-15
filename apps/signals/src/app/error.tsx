"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="standalone">
      <p className="eyebrow">Prospect Signals</p>
      <h1>We couldn’t open this page.</h1>
      <p>
        Please try again. If it keeps happening, contact your administrator.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
