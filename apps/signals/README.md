# Prospect Signals: Phase 1

Separate Next.js app for the Stage 2 build. Phase 1 provides email/password sign-in, password recovery, invitations, database-backed platform authority, client creation and an empty Today view. It does not collect signals or send outreach.

The existing dashboard and the sourcing experiment use their original checkouts. This app shares the intended Supabase project only after the new migration is deployed; no production changes have been applied by this build.

## Run locally

Node 24 is used for verification. From this directory:

```sh
npm ci --ignore-scripts
cp .env.example .env.local
# Fill .env.local locally. Never commit credentials.
npm run dev
```

Open the localhost address printed by Next.js. Without Supabase configuration, sign-in is disabled with a plain message; there is no fake authentication fallback in the app.

Required server configuration:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the existing Prospects project. An existing legacy anon key can occupy the publishable-key setting when necessary. These are the only public settings.
- `APP_ORIGIN`: the canonical app origin. Redirects and cookies use this configured origin, never a forwarded request host.
- `SUPABASE_SERVICE_ROLE_KEY`: server only, used solely to generate Auth invitation links. Normal data operations use the signed-in user and RLS.
- `RESEND_API_KEY` and `RESEND_FROM`: server only; the sender must be on a verified domain.

A super admin presses Send invitation explicitly. No email was sent during this build. Password recovery uses Supabase Auth's configured SMTP service; workspace invitations use Resend. New accounts confirm an Auth invitation, set a password, then explicitly accept the workspace invitation. Existing accounts use their existing password. An email scanner opening an invitation page does not consume its authentication token or grant membership.

Workspace tokens expire in seven days. The initial Auth token may expire earlier according to the project's Auth settings. An expired initial link needs a fresh invitation. Resends revoke previous unaccepted workspace tokens. Acceptance never changes an existing member's role or reactivates a suspended member.

## Checks

```sh
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Database tests run the existing workspace and Step 3a migrations plus the new Phase 1 migration in embedded PostgreSQL (PGlite), with minimal fixtures for prehistory Auth/CRM tables. They exercise real grants and RLS, not string matching. The full old project history still needs its staging replay and live schema verification before deployment.

Browser tests run the production Next build against a local Supabase HTTP contract fixture. They cover both client roles, password flows, protected routes, invitation acceptance, mobile layout and HTTP-only session cookies. Auth gateway signature verification and real email delivery are not simulated guarantees: those need the connected staging/live services. The fixture never contacts real Supabase or email accounts and is never part of the deployed app.

## Deploy and review

See [the Phase 1 runbook](../../docs/signals-phase-1/RUNBOOK.md) for database rollout, Vercel setup and Coris's acceptance checklist. Stop after Phase 1; later phases require Coris to pass those checks.
