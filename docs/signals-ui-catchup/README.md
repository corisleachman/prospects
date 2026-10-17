# UI catch-up for Phases 1–4

Branch `codex/signals-ui-catchup`, based on `codex/signals-phase-4`. The supplied [handoff](../v2/ui-handoff.md) and [interactive prototype](../v2/prototype.html) define the layouts and controls. The existing Frame shell, DM Sans/DM Mono fonts, paper background, navy and coral remain.

Client overview now lives at `/clients/[id]`; setup is `/clients/[id]/setup`. Setup has seven steps, with steps 3–6 labelled Coming in Phase 5 and step 7 Coming in Phase 7. Team routing and invitations move into step 6 in Phase 5. Creation opens step 1. Profile tabs include editable codes and the plan limit. Codes are unique within each client; existing profiles get neutral sequential codes rather than invented business categories.

Industry chips accept only published Blitz values. Country chips map to HQ country codes, US states to HQ state filters, and the labelled metro choices to city keyword filters. Country/state/city alternatives use separate bounded calls, with de-duplication and the full cap quoted before approval. Titles map to the provider's literal title filter. Enter adds, pasted commas/newlines split, duplicates are ignored, the chip text edits and × removes.

Revenue is stored in USD; revenue and headcount use the requested from/to choices. Any ignores that bound; a top `+` upper bucket leaves the upper bound open. Invalid ranges remain in local recovery drafts and cannot overwrite the saved profile. The free-number and currency inputs are gone. Company types were search hints rather than a native filter, so the field is removed; existing stored criteria are preserved. Names/websites use chips. A profile preview summary links to the existing estimate-and-approve screen.

Clients has stat tiles and the fuller table. Today stays in the client navigation; admin navigation links to Clients, the selected client, Setup, Runs and costs and Budgets. The overview includes budget, watch counts, profile details and an administrator-only View as client preview. Budget and collection metrics have honest empty values until their phase produces them. The global Budgets table opens the existing detailed budget actions. Runs currently lists discovery; Phase 6 adds collection statistics.

## Prototype comparisons

Each row links to the application screenshot beside its matching prototype screenshot. All fixtures are labelled test data. The images have exact 1280px or 390px viewport widths; full-page heights differ with content.

| View | App 1280 | Prototype 1280 | App 390 | Prototype 390 |
|---|---|---|---|---|
| Clients | [App](app-clients-1280.png) | [Reference](prototype-clients-1280.png) | [App](app-clients-390.png) | [Reference](prototype-clients-390.png) |
| New client | [App](app-new-client-1280.png) | [Reference](prototype-new-client-1280.png) | [App](app-new-client-390.png) | [Reference](prototype-new-client-390.png) |
| Overview | [App](app-overview-1280.png) | [Reference](prototype-overview-1280.png) | [App](app-overview-390.png) | [Reference](prototype-overview-390.png) |
| Client details | [App](app-details-1280.png) | [Reference](prototype-details-1280.png) | [App](app-details-390.png) | [Reference](prototype-details-390.png) |
| ICP profiles | [App](app-profiles-1280.png) | [Reference](prototype-profiles-1280.png) | [App](app-profiles-390.png) | [Reference](prototype-profiles-390.png) |
| Budgets | [App](app-budgets-1280.png) | [Reference](prototype-budgets-1280.png) | [App](app-budgets-390.png) | [Reference](prototype-budgets-390.png) |
| Full Find / prototype inline preview | [App](app-find-1280.png) | [Reference](prototype-find-1280.png) | [App](app-find-390.png) | [Reference](prototype-find-390.png) |

## Differences and reasons

- The app retains its existing lighter top bar and wordmark. The prototype role switch is demonstration-only; the real View as client action checks platform-admin access and shows an Exit banner.
- The app keeps its native typography, button treatment and flat sections. Mobile navigation and setup steps scroll horizontally; wide tables scroll inside their own boxes.
- The prototype contains fictional cards, five profiles and example totals. The app uses real values or `–`; it does not seed fictional cards or claim unbuilt delivery metrics. Morning list time and recipients say Not configured until Phase 5.
- Cost and budget text remains GBP. Revenue filters are USD as requested. Monthly spending excludes labelled test charges and uses the current UTC calendar month; budget rows retain each client's actual period.
- Coris approved truthful ownership copy: Add related brands explicitly. Parent/sub-brand expansion remains unsupported and is never implied. Refresh stays opt-in; the preview describes its actual setting instead of promising weekly refresh or inventing a monthly cost.
- Coris approved labelled city/metro keyword matching rather than exact metro boundaries. Suggestions cover countries, US states and a curated city/metro list; no unsupported radius or geographic ID is fabricated.
- The full Find screen remains separate for approval and selection. The prototype only has its inline sample panel. The app groups saved people under one company heading and uses small navy checkboxes. Revenue/headcount bands say Not provided when absent from the provider response; they are never guessed.
- Website and client type are now optional saved metadata for the overview. Logo and the placeholder plan selector stay because the build brief requires them. Setup links to the existing budget controls rather than interpreting the prototype's free-text budget example as a billing instruction.
- Watch-list size and When no person is found remain, as required by the brief even though the prototype omits them. New profile codes are editable; existing profile names and criteria are not rewritten.
- The test sentence previously visible in Conversation to open came from screenshot fixture data. Fixtures now use meaningful example prose; the app does not remove genuine user text.

## Verification

Database tests preserve stale-edit checks, profile caps, cross-client isolation, unique codes, immutable cost records and reservations. Adapter tests check industry values and native location mappings, alternative-query caps and receipt handling. Browser tests cover the revised creation route, autosave recovery, chip de-duplication, invalid filters/ranges, stale tabs, grouped watch lists, admin preview and mobile overflow. No paid discovery or email is needed for these checks.

The migration also passed against Prospects inside a transaction that rolled back: default/edited codes, uniqueness, revision checks, website metadata and the admin-only monthly aggregate. Production rollout is recorded below once verified.

## Rollout, 17 October 2026

Migration applied to Prospects; discovery worker version 5 deployed. Vercel deployment `dpl_BZkSFe344bjybLmzbpbUnrYLTfdy` serves the new setup and overview routes. An authenticated read-only browser check verified the actual BEFORE:WORK profile text, codes, chip controls, dropdown choices, last preview counts and disabled future steps. No live profile or budget fields were edited by that check.

BEFORE:WORK still has its £10 normal budget, £0.168540 reported discovery spend and no enabled refresh. The security advisor reports only the existing pg_net extension warning. Draft PR: https://github.com/corisleachman/prospects/pull/36, stacked on Phase 4. Verification: 38 Node tests, 14 browser tests, Deno check and production build pass.
