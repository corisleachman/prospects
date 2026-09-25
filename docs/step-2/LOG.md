# Step 2 log

**25 Sep 2026: Stage 2a (database) applied to live**
- `20260925100000_agency_master_notes_merge`: agency → people sync (changed fields only, loop-safe), rename keeps `name_key` in step (a rename onto an existing name is refused, so merge instead), `agency_notes`, `merge_agencies` / `unmerge_agencies` with an `agency_merges` undo record, `agency_summary` view (people, decision-makers, furthest relationship stage, last contacted, notes), `agency_tidy_suggestions()` + dismissals.
- `20260925100100_import_staging`: `import_batches`, `import_rows`, `import_suggest` / `import_commit` / `import_undo`.
- Tested locally on a full replay (sync, rename, merge + undo, summary, tidy, an 8-row import covering match / new / similar / repeat / agency-only / move / skip, undo with an edited record kept, stranger isolation). Live objects' fingerprints match the tested build (25/25). Live rolled-back check as owner passed: edit → 2 people updated, merge/undo, import suggest/commit/undo.
- Matching note: `&` → "and" means "Heaps + Stacks" and "Heaps & Stacks" have different exact keys. A looser key that ignores "and" (`private.agency_loose_key`) is used for **suggestions only**, never automatic matches.
- Tidy list on live: 4 shared websites, 17 similar names, 17 odd names, 308 agencies without a website.

**25 Sep 2026: Stage 2b (Agencies screen) shipped**
- Agencies list/profile now read the `agency_summary` view. People, decision-makers, furthest stage and last contact are computed from loaded contacts so they're always current. Falls back to the old contact grouping if the table can't be loaded.
- List: tier filter (All / Focus / Watch / Untiered / Excluded; Excluded hidden by default), Has decision-maker, Quiet 90d+, 2+ people, sort by people / tier / stage / last contact / name, new columns (DMs, furthest stage, last contact).
- Profile: tier picker (with undo), rename (with undo; clash → "use Merge instead"), merge panel (confirm + undo), dated notes (add, delete with undo), decision-makers flagged and listed first, relationship stage per person. Edits save once to the agency; the database copies them to its people.
- Needs tidying: duplicate pairs (keep A / keep B / different agencies), odd names (rename / exclude / looks fine), no-website list.
- Research queue: new batches skip Excluded agencies and take Focus, then Watch, first.
- Tested in headless Chrome against mocked data: list, filters, tier, edit, rename + clash, notes, merge + undo toast, tidy. No JS errors.

**25 Sep 2026: Stage 2b checkpoint fixes (from Coris's test)**
- *Needs tidying stuck on "Checking…"*: the suggestion query took ~10 s on 1,053 agencies (function call on every pair) and hit the API's 8 s timeout. Migration `20260925110000` adds a stored, indexed `agencies.loose_key` and uses index range scans, so it now takes ~0.2 s on live. `import_suggest` uses the same column. The screen now shows "Couldn't load, Retry" on failure instead of waiting.
- *Merge undo* rewritten to insert with an explicit column list (the new generated column can't be copied).
- *"No company domain on file" when generating emails*: people only carried company details from their own record. The same migration copies the agency's website, domain, LinkedIn, industry, size and location onto people where theirs is blank (never overwrites): people without a company domain went from 1,177 to 336. Email guessing now prefers the most common real work-email domain among colleagues at the same agency (free mail and bounces ignored), then the company or agency domain, then the website. Example: Human After All → humanafterall.co.uk (from Rob), not the .studio website.
- *Split view*: an agency profile now has a left rail of agencies, using the same filters and sort as the list, with an instant filter; ↑/↓ switch agency, Enter opens the top match, Esc clears. Hidden below 1,000 px width.
