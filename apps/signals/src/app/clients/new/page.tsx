import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import { createClientWorkspace } from "../actions";
export default async function NewClient() {
  const { user } = await requireAdmin();
  return (
    <Frame admin email={user.email ?? ""}>
      <div className="screen-head">
        <div>
          <h1>New client</h1>
          <p className="muted">Start with their name and time zone.</p>
        </div>
      </div>
      <div className="client-setup">
        <aside className="setup-nav" aria-label="Setup steps">
          {[
            "Client details",
            "ICP profiles",
            "Signals",
            "Sources",
            "Voice and copy",
            "Who gets what",
            "Test and go live",
          ].map((label, i) => (
            <button
              key={label}
              disabled={i > 0}
              aria-current={i === 0 ? "step" : undefined}
            >
              <span className="step-number">{i + 1}</span>
              {label}
            </button>
          ))}
        </aside>
        <section className="section setup-content">
          <form action={createClientWorkspace}>
            <label>
              Client name
              <input name="name" maxLength={120} required />
            </label>
            <label>
              Timezone
              <select name="timezone" defaultValue="Europe/London">
                {[
                  "Europe/London",
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "Europe/Paris",
                  "Asia/Singapore",
                  "Australia/Sydney",
                  "UTC",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <Submit>Create client</Submit>
          </form>
        </section>
      </div>
    </Frame>
  );
}
