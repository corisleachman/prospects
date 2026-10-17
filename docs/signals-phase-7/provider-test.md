# Bounded production test, 17 October 2026

Run: `0c7e7a08-5d62-4beb-8554-d34301cd9ecd`.

45 previously collected items were still inside the 48-hour window. No new source data was purchased. The run ended partial, with no client delivery and no usable cards: 43 items didn't match a profile, one scored 5, and one scoring result failed evidence validation. No threshold was lowered to produce a sample.

| Stage | Recorded cost GBP | Cache read input tokens | Cache creation input tokens |
|---|---:|---:|---:|
| Haiku triage | 0.003032 | 229,768 | 5,222 |
| Sonnet score and write | 0.023639 | 9,420 | 4,710 |
| Total | 0.026671 | 239,188 | 9,932 |

All provider calls settled; no reservation is waiting for a batch receipt. No response stopped at max_tokens. Triage and scoring both confirmed real cache reads. The ledger includes failed validation costs and a canceled batch request. It doesn't hide a charge when a result can't be used.

The test exposed two validator issues. Whole-word matching treated straight and curly apostrophes differently, incorrectly rejecting Arby’s. Normalising typographic quotes fixed this without admitting substring brand matches, and the original completed batch response was revalidated without another paid triage call. The email sentence counter also counted a greeting/sign-off as extra sentences; it now counts the body while still rejecting a fourth body sentence. Parsed complete outputs are retained under platform-only RLS for future validation audits. Truncated JSON is never parsed.

The remaining failed score did not supply a supporting quote present in the evidence. It stays rejected. The original response isn't treated as a verified opener, and the run cannot pass the Go live gate. BEFORE:WORK remains in setup with no approved watch list, live recipient or real voice examples. Total normal client spend is £0.195211, leaving £9.804789 of its £10 budget; previous fake budget-test charges are excluded.
