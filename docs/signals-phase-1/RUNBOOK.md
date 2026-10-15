# Stage 2 / Phase 1: new app, login and roles

This branch implements Phase 1 of Coris's Stage 2 build brief. The app lives in `apps/signals/`. Existing HTML pages, CRM tables, edge functions and old migrations are unchanged. Nothing sends prospect outreach. No Phase 2 profiles, watch lists or pipeline were built.

## What is ready

- A separate Next.js app with the existing cream/navy/coral visual language.
- Email/password login, sign-out and password recovery; no self-service signup.
- Private platform authority, bootstrapped only from Coris's existing verified legacy owner account.
- The Clients list, basic client creation and explicit team invitation forms.
- New client-admin and client-user access, with no access to setup or cost records.
- Expiring invitations with hashed tokens, email-bound acceptance, revocation on resend, one-time use, and delivery status.
- An empty Today view for the current user's client, with a workspace selector when they belong to more than one.

`is_signals_client` explicitly distinguishes new client workspaces from every existing workspace. The new restrictive policies apply only to these new spaces. Legacy workspace configuration permissions and existing CRM policy definitions stay intact. Existing client-admin roles are not silently reinterpreted in old workspaces.

Global authority is an intentional exception to client-only membership: the platform administrator sees all new client workspaces and invitation records. Both new tables still carry `workspace_id`, and platform authority is stored separately from client roles. Clients cannot insert or update either their membership or platform authority. Private security-definer RPC implementations use fixed empty search paths and explicit identity/role checks; public endpoints are security invokers with explicit grants.

Foundation data is closed to new client roles until later phases add the precise card policies. This is deliberate for Phase 1, whose Today view has no cards; do not remove the restrictive policies wholesale when adding Phase 8.

## Deployment prerequisites

The repository points at the existing Prospects Supabase project. The connected Supabase tool account did not list it and explicitly denied read access. No remote schema was changed. The migration was verified locally, but live schema compatibility, SMTP settings and real invitation delivery remain unverified.

1. Connect the correct Prospects Supabase project before deployment. Confirm its existing columns and policy names against the migration. Use a staging branch/database first, including the actual older prehistory schema.
2. Review and apply only the new `signals_phase_one` migration through the normal migration workflow. Do not modify old migrations. Confirm Coris's verified owner account produced exactly one active platform-admin row; if it did not, stop and verify the account rather than granting authority to an email supplied by a browser.
3. Create a Vercel project rooted at `apps/signals`, with the Next.js preset and Node 24. Build command: `npm run build`; install: `npm ci --ignore-scripts`. Do not repoint the existing GitHub Pages site.
4. Set the app's environment variables from `.env.example` in Vercel. Add the chosen preview/production origin to Supabase Auth's redirect allowlist, including `/auth/callback`. Use a stable preview alias while testing; changing the host invalidates the intended redirect origin.
5. Keep the existing V1 Auth site URL and working redirects. Add this app's redirects rather than replacing them. Disable public signup for this invitation-only app only after confirming that shared-project V1 does not need signup; the app itself exposes no signup route.
6. Password recovery's default PKCE template uses `/auth/callback?next=/set-password`. If the project uses custom templates, make the recovery template point to the new app's `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password`, without changing V1 flows. Verify this on staging first.
7. Configure Resend's verified sender for workspace invitations. Auth tokens use the project's existing invitation expiry; workspace invitation tokens expire after seven days. Reconcile those settings and test expiry copy before launch.
8. Run Supabase's database advisors/security checks on the staging project, then complete the checks below. Any production migration or final publication requires a concrete reviewed rollout; no live rollout was attempted here.

## Coris's Phase 1 checks

- [ ] Sign in at the new address and see Clients.
- [ ] Create a test client, invite a test email as a client user, and receive the invitation.
- [ ] Open the invitation, set a password and accept the workspace invitation.
- [ ] As that user, see only their Today view; entering the Clients URL shows Not allowed.
- [ ] Repeat with a client admin; they can view Today but cannot access setup or costs.
- [ ] Try another client's workspace URL; no data appears.
- [ ] Reset the test user's password and sign out/in again.
- [ ] Check used, revoked, expired and wrong-email invitation links fail safely.
- [ ] Coris's original dashboard, researcher queue and Chrome extension still work on the live project after rollout.

Stop here for Coris's acceptance. Do not begin Phase 2.
