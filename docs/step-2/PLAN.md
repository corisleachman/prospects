# Step 2 — Agency-aware import · Plan for approval

**Goal:** make agencies the thing you work with. You can load a file like the Creative Boom list and have agencies, people and intel land in the right places after a quick review. The Agencies screen becomes the single place to see and edit an agency, and a simple tier tells the system (and later the insights engine) which agencies matter.

**Unchanged:** the Research queue, Ready for Coris, email, relationship stages, the Signals modal, the Chrome extension and Find people. Existing imports still work the same way until the new one replaces them.

---

## What you'll see

### 1. Agencies screen, rebuilt on the agencies table

**List view**
- One row per real agency. Name variants the database has already merged ("Heaps + Stacks" / "Heaps Stacks") show as one agency.
- Columns:
  - Agency and location.
  - **Tier**.
  - People (total, and how many are decision-makers).
  - Furthest relationship stage reached.
  - Last contacted.
  - Website.
- Filters: tier, has decision-maker, not contacted in 90+ days, needs tidying. Search and sort stay as they are.
- A **Needs tidying** view lists:
  - likely duplicates (same website, or one name starting another);
  - odd names ("ATTN:", "To", pasted-in headlines);
  - agencies with no website.
  
  Each item has one-click Merge, Rename or Dismiss.

**Profile view**
- Edits save to the agency once. Every person at that agency then shows the same website, LinkedIn, size and location. No more patching each contact.
- **Tier selector:** Focus · Watch · Excluded · (none).
- **Merge into…:** pick the agency to keep. People, details and notes move across, and the empty record is removed. Undo is available straight afterwards.
- **Rename:** people at the agency follow the new name.
- **Agency notes:** a dated log. Imported intel lands here as entries in the form "22 Sep 2026 · Creative Boom · Koto acquires Stereo Creative → link".
- Find people and Find with AI stay as they are.

**Tier meanings**

| Tier | Meaning | Effect now | Effect in Step 3 |
|---|---|---|---|
| Focus | Actively pursuing | Filter + badge; Research queue pulls these first | Checked daily for reasons to get in touch |
| Watch | Interesting, not now | Filter + badge | Checked less often |
| Excluded | Not a fit (network, not an agency, wrong country) | Hidden from Research queue batches | Never checked |
| none | Not yet decided | — | Not checked |

### 2. Import, rebuilt as three steps

1. **Upload & map.** Upload a CSV file; for Excel, save as CSV first. The current column mapping stays, with four new fields:
   - Agency-only rows: an agency with no person is now allowed.
   - Intel / note.
   - Source link.
   - Date.
   
   You also pick defaults for the whole file: list (category), tier for new agencies, and whether new people enter the Research queue.
2. **Review matches.** Each row is shown with what will happen to it:

   | For the agency | For the person |
   |---|---|
   | ✓ **Matches** an existing agency | ✓ **Already in database**: fill blanks only, never overwrite |
   | ＋ **New** agency | ＋ **New** person |
   | ? **Possible match**, e.g. "Koto APAC" → Koto? You choose: match / new / skip | ? **Possible duplicate**: same name at a different agency (a move?). Choose: update / new / skip |
   |  | — **No person** (agency-only row) |

   Summary chips across the top (e.g. "112 new agencies · 34 matched · 9 to check · 105 new people · 12 existing · 2 possible moves"). Filter to "Needs a decision", change any row, or bulk-set "all possible matches → new". Nothing is written yet.
3. **Confirm.** Everything is written in one go, so it either all lands or none of it does. You get a summary, plus **Undo this import**. Undo removes what the import created and reverses what it filled in, as long as you haven't edited those records since.

### 3. First real load: the Creative Boom file

Loaded through the new import with you on the review screen:
- **Agencies** you mark as targets come in as **Watch**, with their intel as dated notes. Networks and non-agencies are left out, using the triage flags you've already seen.
- **The 105 decision-makers** come in as people and go to the Research queue as *unverified*. Your son confirms each one's current role and LinkedIn.
- **Intel on existing contacts** (e.g. Ourselves, Heaps + Stacks) is added to their agency notes. Nothing is overwritten.
- **The two possible moves** (Amy Searle, Ollie Olanipekun) show up as "possible duplicate" for you to decide.

---

## Behind the scenes

- **The agency is the master record for company details.** When an agency is edited, a database trigger copies its website, LinkedIn, size and location onto its people's existing company fields. That keeps everything that reads those fields working unchanged: email `{{company}}`, the research card, enrich, Finder and the extension. The trigger from Step 1 (contact → agency, filling blanks only) stays. The two can't loop, because one only fills blanks and the other only writes to contacts.
- **Rename** updates `contacts.company` for the agency's people. **Merge** is one database function that moves people, fills blanks from the dropped agency, combines notes, and deletes the empty record in a single transaction.
- **Import staging:**
  - two small tables, `import_batches` (file, defaults, status, summary) and `import_rows` (the raw row, the suggested match, your decision, what got created);
  - a server function `import_commit(batch)` that applies all decisions atomically;
  - `import_undo(batch)`.
  
  Rows stay in staging, so you can always see which import added what.
- **Notes stay lean,** as you asked: no evidence tables. Agency notes are dated entries, with source and link, in a small `agency_notes` table (agency, date, source, text, link, created by). A single text field was the alternative, but a table allows the dated log and a clean undo.
- **Agency summary view:** people count, decision-maker count, furthest relationship stage and last contacted, calculated in the database so the list stays fast.
- **Security and workspaces:** all new tables get `workspace_id`, workspace access rules and explicit permissions, per `AGENTS.md`. Server functions check workspace membership before touching anything.
- **Follow-up from Step 1:** `notify-enquiry` is changed to refuse requests without the webhook secret. It's deployed only after an Action confirms `WEBHOOK_SECRET` is set; the Action reads secret names only, never values.
- **Design:** uses the current palette (paper / navy / orange) and existing components.

---

## Build order and checkpoints

Same working method as Step 1: tested locally against a replay of live, each stage in one transaction, and a smoke test before anything irreversible.

| Stage | What | Checkpoint |
|---|---|---|
| 2a | Database: `agency_notes`, `import_batches`, `import_rows`, agency → contact sync trigger, merge / rename / import functions, summary view | Local tests + live verification |
| 2b | Agencies screen rebuilt: list, profile, tier, merge, rename, notes, Needs tidying | **You check it** (about 10 minutes) |
| 2c | Import rebuilt: upload & map, review, confirm, undo | **You try it** with a small test file |
| 2d | Creative Boom load, with you on the review screen | You approve the matches |
| 2e | `notify-enquiry` fail-closed (after the secret check) | Test enquiry |

## Not in Step 2

The insights engine (Step 3), evidence or signal tables, Excel upload (use CSV), Companies House bulk loads, a client-workspace UI, and a separate researcher login.

---

## Decisions needed

1. **Agency as master:** agree that editing an agency updates the company details shown on all its people.
2. **Existing 1,048 agencies:** start them all untiered, so you set Focus/Watch as you go? The import can tier new agencies in bulk.
3. **Creative Boom scope:** import only target agencies as Watch (networks and non-agencies excluded), plus the 105 decision-makers into the Research queue as unverified, plus intel as notes?
4. **Undo rule:** an import can be undone until you edit any record it created or changed; edited records are left alone and listed. OK?
5. **Carousel / Carousel (Manchester):** keep separate (different websites)?
