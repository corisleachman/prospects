# Phase 1: client access and setup

Earlier verification and deployment details are in [VERIFICATION.md](VERIFICATION.md) and [RUNBOOK.md](RUNBOOK.md).


## UI catch-up, 17 October 2026

The prototype guides the layout and controls; the app keeps its visual style. See [the catch-up record](../signals-ui-catchup/README.md) for verification and approved differences.

| View | App 1280 | Prototype 1280 | App 390 | Prototype 390 |
|---|---|---|---|---|
| clients | [App](catchup-app-clients-1280.png) | [Reference](catchup-prototype-clients-1280.png) | [App](catchup-app-clients-390.png) | [Reference](catchup-prototype-clients-390.png) |
| new-client | [App](catchup-app-new-client-1280.png) | [Reference](catchup-prototype-new-client-1280.png) | [App](catchup-app-new-client-390.png) | [Reference](catchup-prototype-new-client-390.png) |
| overview | [App](catchup-app-overview-1280.png) | [Reference](catchup-prototype-overview-1280.png) | [App](catchup-app-overview-390.png) | [Reference](catchup-prototype-overview-390.png) |

Differences: The production shell has no demo role switch. New-client creation persists a client before later steps; real counts replace fictional figures. Unknown delivery metrics show `–`. The overview shows Not configured until routing exists.
