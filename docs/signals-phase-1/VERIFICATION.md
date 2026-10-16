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
| Production protection | No diff to existing HTML pages, CRM schema definitions, previous migrations or existing edge functions. Phase 1 migration applied after staging verification; no app deployment yet. |

## Live database verification, 16 October 2026

The corrected account connection reached Prospects. All 13 foundation tables, workspace columns, role constraints and existing policies matched the migration. The bootstrap query found exactly one verified legacy owner.

An isolated Supabase branch replay initially failed because the production migration-history baseline stores a comment instead of executable schema. The repository's reconstructed baseline restored the empty branch; all 31 later repository migrations, including Phase 1, replayed successfully. One MCP-generated migration version collided within the same second; that transaction rolled back and succeeded on retry. Production history was not repaired or rewritten.

[staging-check.sql](staging-check.sql) passed against that real Supabase database: administrator RPC, invitation preview/acceptance, workspace isolation, client setup denial and invitation replay rejection. Test users and workspaces rolled back. Staging security advisors reported no notices. The temporary branch was deleted after verification.

The committed Phase 1 migration was then applied to Prospects. Post-application checks confirmed exactly one active platform administrator matching the verified owner, RLS on both new tables, all 13 restrictive policies and zero new client workspaces. Existing CRM membership policies remain present. Production security advisors reported only the same pre-existing [pg_net extension warning](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) seen before rollout.

## Remaining external checks

Vercel project `corisleachmans-projects/prospect-signals` is created, linked locally and configured for `apps/signals`, Next.js and Node 24, with deployment protection. Public Supabase URL and publishable key are set for production, preview and development. The connector denied environment writes; the mapped authenticated CLI fallback succeeded.

Production deployment completed on 16 October 2026 from commit `114c16d`: `dpl_EGBGFDZLbuXBg3cSLg2j3ko3Kz6n`, https://prospect-signals.vercel.app. The remote build and TypeScript check passed. APP_ORIGIN is the canonical HTTPS alias. Coris supplied SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY and RESEND_FROM as sensitive Vercel settings for all environments; their values are intentionally unavailable for local inspection. The temporary environment download was removed.

Authenticated Vercel HTTP checks confirmed login and forgot-password return 200, login contains email/password inputs, and anonymous Clients/Today requests redirect to login. Deployment protection remains enabled. No real invitation or recovery email was sent, and no user's password or session was changed.

Remaining: Coris signs in with his existing credentials and completes the client/invite checks. Real invitation delivery and password recovery are unverified. Supabase Auth redirect allowlist/template compatibility still needs checking before recovery acceptance. No Git hosting connection has been added. Coris's live dashboard and extension acceptance checks remain outstanding. Phase 2 has not started.

## Screenshots

These use local, explicitly labelled test clients and accounts.

- [Login](login-desktop.png)
- [Clients](clients-desktop.png)
- [Today on mobile](today-mobile.png)
