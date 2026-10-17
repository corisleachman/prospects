# Phase 6: collect and filter

Manual collection now runs from Runs and costs. The tested trade and wire feeds, AnyAPI Google News through treg, and watched-person LinkedIn posts through Apify have separate adapters. No collection schedule is enabled.

## Prototype comparison

| View | App | Prototype |
|---|---|---|
| Runs, 1280px | [App](app-runs-1280.png) | [Prototype](prototype-runs-1280.png) |
| Runs, 390px | [App](app-runs-390.png) | [Prototype](prototype-runs-390.png) |

Differences:
- The app keeps its existing visual style and GBP budgets. Small paid charges show extra decimal places rather than rounding to zero.
- Usable cards and cost per usable card stay pending until Phase 7 judging is built. A fresh item isn't presented as a usable card.
- Manual collection defaults to public feeds. Include paid sources explicitly adds news and LinkedIn; every paid call reserves budget before making its request. Failed sources can be retried against current settings.
- Open a run to inspect each source, drop reasons, source links and the actual cost ledger. Discovery history stays in a separate table.
- Extra websites need dated Article metadata, or a discovered RSS/Atom feed. A date elsewhere on a page doesn't become an article date.

## Filtering and recovery

Items without dates, outside the window, dated in the future, non-English, financial notices and canonical URL duplicates stop before AI. Whole-word brand matching prevents the Gorenje/KIND false match and doesn't invent parent ownership. English detection runs locally, including when a feed labels itself English; uncertain language is dropped.

Known-brand reports with the same stated event, close dates and near-identical headlines are grouped conservatively. The strongest source stays primary and every report retains its evidence URL. Unknown brands aren't guessed. Further entity classification belongs to Phase 7.

Publisher robots rules are checked before public feed or website reads. Public DNS is checked and pinned, redirects are checked again, and time/body limits apply. A source failure is logged rather than replaced with invented data.

A task has one claim and one cost reservation. Interrupted paid calls record their reserved cap if usage can't be recovered, without repeating the request. Apify run references are saved and polled rather than starting the actor again. Unknown charges remain labelled estimated. Internal worker authentication can continue only an existing approved run.

## Validation

Node/database checks cover filtering, source parsing, publisher rules, grouping, cross-client isolation, exclusive task claims, one-time settlement and budget pauses. Browser checks cover manual collection, run details, drop counts and responsive layouts. Screenshot data is a labelled local fixture. The public HTTP reader was also exercised in Deno against Marketing Dive's live feed.

Migration: `20261017134828_signals_phase_six.sql`.

## Live free-feed check

On 17 October, the deployed worker collected 60 items in run `21bd05da-bf2d-4b06-b441-46963b503137`: 37 passed, 8 were too old, 4 were duplicates, 4 were non-English and 7 were financial notices. Cost: £0. No AI or email ran. Marketing Dive had already supplied three fresh items in the preceding transport check, so those were correctly counted as duplicates.

Business Wire is blocked by its current robots rules. Muse exceeded the initial body limit; the reader now supports the sourcing test's 4 MB bound. Earlier transport failures remain visible as validation runs, with no paid costs.
