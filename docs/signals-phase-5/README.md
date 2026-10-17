# Phase 5: signal rules, sources, voice and routing

Setup steps 3–6 are editable. Rules retain exact keyword syntax and explicit profile scopes. Client-specific sources have a safe public-HTTPS date check. Voice and recipient changes autosave with revision checks. Invitations use the existing verified invitation flow; removal suspends access, and Undo restores it through an administrator-only action.

## Compared with the prototype

The app keeps its existing cream/navy/coral style and fonts. Each pair uses the same viewport and view. Screenshots contain labelled local fixture data.

| View | 1280px app | 1280px prototype | 390px app | 390px prototype |
|---|---|---|---|---|
| Signals | [App](app-signals-1280.png) | [Prototype](prototype-signals-1280.png) | [App](app-signals-390.png) | [Prototype](prototype-signals-390.png) |
| Sources | [App](app-sources-1280.png) | [Prototype](prototype-sources-1280.png) | [App](app-sources-390.png) | [Prototype](prototype-sources-390.png) |
| Voice | [App](app-voice-1280.png) | [Prototype](prototype-voice-1280.png) | [App](app-voice-390.png) | [Prototype](prototype-voice-390.png) |
| Who gets what | [App](app-routing-1280.png) | [Prototype](prototype-routing-1280.png) | [App](app-routing-390.png) | [Prototype](prototype-routing-390.png) |

Differences:
- The source list contains the four tested adapters. LinkedIn says “posts”, because comments and reactions weren't collected. Job changes stays unavailable until a dated provider is verified. The three working trade feeds are retained.
- Default rule scopes resolve against actual profile names, with editable profile-code chips. Unmatched templates display “Choose profiles” rather than targeting an unrelated profile.
- A client-wide Limits line defaults to 10 cards a day and 30 days. Each row inherits those values unless either is overridden. Its collapsed summary marks custom values. Coris requested these controls in addition to the prototype table.
- Extra URLs have visible pending, dated, undated or failed states and an explicit Check action. Private addresses and redirect targets are rejected before requests.
- Draft voice settings can be saved before all three message examples are supplied. The go-live phase will require complete settings.
- Step 7 remains unavailable until Phase 7. No schedule is enabled here.
- Parent-company text requires related brands to be added explicitly. Watch-list refresh stays opt-in. City/metro filters are labelled keyword matches, as agreed with Coris.

## Verification

Database tests cover exact keyword storage, stale saves, scope ownership, invitation-to-member routing, access removal/undo and client isolation. Browser checks save a custom negative rule for two profiles, three example messages and banned phrases, a source window, and an invited recipient with a five-card cap and 08:00 delivery. Test email goes only to a local sink. No paid sourcing or AI requests are used.

Migration: `20261017133154_signals_phase_five.sql`. Existing legacy library values and memberships are preserved. Every new product table has workspace ownership, explicit grants and RLS.
