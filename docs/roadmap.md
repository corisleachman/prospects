# Roadmap (revised 23 Sep 2026)

**Goal:** a focused database of interesting UK agencies and their key people, plus an insights engine that shortcuts research by telling Coris **who to speak to and when**. The existing follow-up and check-in system handles nurture. Full-UK coverage should be possible later by import, not a starting target.

| Step | Scope | Status |
|---|---|---|
| 1 Foundation | Repo holds DB history + server code; workspaces; **agencies table** linked to every contact; security fixes; Research-queue save errors | ✅ Live 25 Sep 2026 |
| 2 Agency-aware import | Upload → staging → review screen → agencies, people and notes land in the right places. Agencies screen reads the agencies table. **Focus / watch / excluded** tier on agencies. First load: Creative Boom file. | Next |
| 3 Insights engine | A daily **"Who to speak to"** list for focus agencies. It runs the existing LinkedIn scan plus a news/web check per focus agency, and accepts pasted items (e.g. newsletters). Each suggestion shows one line of *why*, the link and date it's based on, and a short draft opener. Done / snooze / dismiss feed the existing follow-up dates. | After 2 |
| Later | Evidence history per agency, multiple campaigns, voice learning, client workspaces, full-UK bulk loads (Companies House) | Parked |

Deliberately **not** in Step 3: a research archive per agency or person. Each suggestion keeps only its source link and date, enough to trust it and to avoid suggesting the same thing twice.
