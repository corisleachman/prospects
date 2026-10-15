# Phase 1 verification

Story: the platform administrator signs in, creates a private client workspace and invites a user. The recipient confirms their identity, sets a password and accepts the stored role. Client roles see an empty Today view and cannot reach administration or another client's data.

| Boundary | Evidence |
| --- | --- |
| Production application | Next.js production build and strict TypeScript check pass. All protected pages render dynamically. |
| Database | 18 local tests pass, including the real workspace, Step 3a and new Phase 1 migrations executed in embedded PostgreSQL with minimal prehistory fixtures. |
| Security | SQL tests cover platform-role escalation, client-admin configuration writes, cross-workspace reads, direct membership edits, wrong-email acceptance, suspended and unverified users, expiry, replay and revocation. Existing legacy and non-Signals workspace behavior is retained. |
| Email transport | Mocked transport tests verify recipient, HTML escaping, idempotency key, missing configuration and provider errors. No real email is sent. |
| Browser | Production-server browser tests exercise login, logout, both client roles, direct admin URLs, another workspace URL, non-enumerating recovery, new-user password setup, explicit acceptance and reused links. |
| Session and layout | Browser checks verify HTTP-only SameSite cookies and no horizontal overflow in the mobile Today view. Desktop login and Clients screenshots plus a mobile Today screenshot are included. |
| Dependencies | npm audit reports no known vulnerabilities in production dependencies. Versions and lockfile are pinned. |
| Production protection | No diff to existing HTML pages, CRM schema definitions, previous migrations or existing edge functions. No live schema change or deployment was made. |

## Remaining external checks

The connected Supabase account denied access to the repository's actual project. This blocks live schema comparison, database advisors, real token verification against that Auth gateway, SMTP validation and a real invitation-delivery test. The local HTTP fixture verifies the SDK/application contract, not the live provider configuration.

Use the runbook and the prepared migration on a staging branch with the correct account. Then deploy the new app with its real server configuration and complete Coris's Phase 1 checklist. Phase 2 has not started.

## Screenshots

These use local, explicitly labelled test clients and accounts.

- [Login](login-desktop.png)
- [Clients](clients-desktop.png)
- [Today on mobile](today-mobile.png)
