# Google account access

The `/cuenta` page is reachable through the compact **Mi cuenta** link. Existing anonymous users choose **Vincular mis proyectos con Google**. This uses `linkIdentity`, retaining `auth.users.id`, project owners, RLS and Storage ownership. It does not migrate or delete records.

New browsers may visit `/cuenta` directly and sign in with Google. An already-created anonymous session may explicitly recover an existing account only if its project count is confirmed as zero, both before OAuth and on callback. Non-empty sessions and failed checks are blocked. Save pending edits before starting. Conflicting identities are not merged automatically.

## Configuration

- Enable Google and manual identity linking in Supabase Auth. Keep existing anonymous access and RLS intact.
- Google Web OAuth client redirect: the project's Supabase `/auth/v1/callback` URL.
- Supabase Site URL: the canonical application origin.
- Allow the exact application `/auth/callback` URL in Supabase Redirect URLs. Add controlled Preview callbacks individually, never a broad wildcard.
- OAuth client secret lives only in Supabase provider configuration, not the app, source or browser bundle.
- While Google is in Testing, only permitted test users should be used. No Drive/Gmail API access is requested.

## Safety

OAuth is PKCE. Starting it requires same-origin POST. An HTTP-only, secure, short-lived intent cookie records the original user. Callback code and identity are checked before buffered session cookies are committed. Cancellation, expired state, UID mismatch or exchange failure do not overwrite the current session. Callback redirects only to `/cuenta`, uses no-store and suppresses referrers. A connected permanent session cannot switch accounts via this flow. No new dependencies, database migrations, service-role keys or policy changes.

## Verification

Run the two `src/modules/auth/google-*.test.ts` suites with the existing TypeScript/Node test toolchain. They cover same-UID linking, cross-origin rejection, protected recovery, missing/expired/cancelled flows, identity conflict, open-redirect input and cookie preservation on failed or mismatched exchanges. UI tests should confirm account states and existing project counts.

For the first real account link, use the canonical Production origin with the user's existing projects, NOT an empty Preview session. Record project IDs and count before linking; verify those IDs after Google consent and full reload. Do not sign the original anonymous session out as a test. A successful health check or build is not proof that linking completed.

## Backups are separate

Google login protects recoverable access, not against deletion or platform failure. A database backup does not include Storage image bytes. Full backup configuration and a restore check are a separate operational step; this feature does not claim those exist.
