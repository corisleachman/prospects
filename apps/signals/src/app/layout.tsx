import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: { default: "Prospect Signals", template: "%s · Prospect Signals" },
  description: "Fresh reasons to connect. Human decisions, always.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
