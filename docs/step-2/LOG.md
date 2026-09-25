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
