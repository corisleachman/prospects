# Roadmap (revised 23 Sep 2026)

**Goal:** a focused database of interesting UK agencies and their key people, plus an insights engine that shortcuts research by telling Coris **who to speak to and when**. The existing follow-up and check-in system handles nurture. Full-UK coverage should be possible later by import, not a starting target.

| Step | Scope | Status |
|---|---|---|
| 1 Foundation | Repo holds DB history + server code; workspaces; **agencies table** linked to every contact; security fixes; Research-queue save errors | ✅ Live 25 Sep 2026 |
| 2 Agency-aware import | Upload → staging → review screen → agencies, people and notes land in the right places. Agencies screen reads the agencies table. **Focus / watch / excluded** tier on agencies. First load: Creative Boom file. | Next |
| 3 Insights engine | Campaign and unified evidence foundation, piloted through one **"Who to speak to"** queue for focus agencies. It preserves the current LinkedIn scan, adds researcher evidence and a news/web source, then proves matching and deduplication before message drafting. The schema supports several campaigns even though the first interface shows one. | Foundation built and branch-verified; production approval pending. See the [technical plan](step-3/PLAN.md). |
| Later | Full campaign-builder UI, voice learning, external client activation, full-UK bulk loads (Companies House) | Parked |

Deliberately **not** in the first Step 3 slice: a research-archive screen, scheduling or message generation. The evidence store keeps the minimum excerpt, link and date needed to verify and deduplicate a suggestion.
