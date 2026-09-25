# Step 2 log

**25 Sep 2026: Stage 2a (database) applied to live**
- `20260925100000_agency_master_notes_merge`: agency → people sync (changed fields only, loop-safe), rename keeps `name_key` in step (a rename onto an existing name is refused, so merge instead), `agency_notes`, `merge_agencies` / `unmerge_agencies` with an `agency_merges` undo record, `agency_summary` view (people, decision-makers, furthest relationship stage, last contacted, notes), `agency_tidy_suggestions()` + dismissals.
- `20260925100100_import_staging`: `import_batches`, `import_rows`, `import_suggest` / `import_commit` / `import_undo`.
- Tested locally on a full replay (sync, rename, merge + undo, summary, tidy, an 8-row import covering match / new / similar / repeat / agency-only / move / skip, undo with an edited record kept, stranger isolation). Live objects' fingerprints match the tested build (25/25). Live rolled-back check as owner passed: edit → 2 people updated, merge/undo, import suggest/commit/undo.
- Matching note: `&` → "and" means "Heaps + Stacks" and "Heaps & Stacks" have different exact keys. A looser key that ignores "and" (`private.agency_loose_key`) is used for **suggestions only**, never automatic matches.
- Tidy list on live: 4 shared websites, 17 similar names, 17 odd names, 308 agencies without a website.
