# Deployment Guidelines

## Custom Domain Configuration
Checklist for configuring and provisioning the `yourbody.fyi` custom domain:
1. **Cloudflare DNS:**
   - Configure DNS records: Apex (`yourbody.fyi`) and `www` (`www.yourbody.fyi`) as CNAME pointing to Vercel (`cname.vercel-dns.com`).
   - Set proxy status to **DNS-only** (gray cloud).
2. **Vercel Domains:**
   - Add domains `www.yourbody.fyi` and `yourbody.fyi` to the Vercel project.
   - Set `www.yourbody.fyi` as Production domain.
   - Configure apex `yourbody.fyi` to redirect (308 Permanent Redirect) to `www.yourbody.fyi`.
3. **Supabase Auth & Secrets:**
   - Set Supabase Auth Site URL to `https://www.yourbody.fyi`.
   - Update Supabase Auth Redirect URLs allowlist to include `https://www.yourbody.fyi/**`, `https://yourbody.fyi/**`, and `capacitor://localhost/**`.
   - Set Edge Function secret `ALLOWED_ORIGINS` in Supabase project dashboard/CLI if any additional origins are needed.
4. **Redeploy Edge Functions:**
   - Redeploy Supabase Edge Functions (`parse-nutrition`) with updated CORS configuration.

## HTTP Strict Transport Security (HSTS)
- The application enables HSTS via `vercel.json` with `max-age=31536000; includeSubDomains; preload`.
- **Important Note:** Because `includeSubDomains` and `preload` are active, any future `yourbody.fyi` subdomain must be served exclusively over HTTPS. Plain HTTP requests to subdomains will be automatically upgraded and blocked by modern browsers if valid TLS certificates are not provisioned.

## Brand & Identifier Inventory
Comprehensive inventory of internal identifiers, runtime keys, and preserved historical records:

### Renamed Runtime Identifiers
- Renamed storage prefix: `cybergym_` -> `yourbody_` (localStorage user profile, view mode, rest timer keys)
- Renamed IndexedDB database: `cybergym-offline-<userId>` -> `yourbody-offline-<userId>`
- Renamed Web Locks: `cybergym-outbox-<userId>` / `cybergym-aiq-<userId>` -> `yourbody-outbox-<userId>` / `yourbody-aiq-<userId>`
- Renamed BroadcastChannel: `cybergym_outbox_channel` -> `yourbody_outbox_channel`
- Renamed package name: `cybergym` -> `yourbody` (`package.json`, `package-lock.json`)
- Renamed Android app ID / namespace / applicationId: `fyi.yourbody.app`
- Renamed coach-code prefix: `CYBER-` -> `YB-` (migration M11, seed data, test fixtures)
- Renamed test accounts: `@cybergym.io` -> `@yourbody.fyi`
- Renamed data export filenames: `cybergym-*` -> `yourbody-*`

### Preserved Historical Records
The following occurrences are permanently preserved and allowlisted in `check:brand`:
- Historical records: `docs/perf-baseline.md`, `docs/query-plans.md` — immutable historical engineering records.
- Applied migrations: `supabase/migrations/20260909000000_multi_coach_code_linking.sql`, `supabase/migrations/20260916230000_get_ghost_sets_rpc.sql`, `supabase/migrations/20260916233000_get_ghost_sets_per_exercise_cap.sql`, and rollback `supabase/rollback/20260916233000_down.sql` — already-applied immutable database schema history.
- Capacitor test template packages: `com.getcapacitor.myapp` in `android/app/src/androidTest/` and `android/app/src/test/` — default Capacitor template classes.

## Frontend Hosting (Vercel)
- The React application is deployed via Vercel.
- Ensure `vercel.json` contains proper routing fallbacks to `index.html` for React Router.
- Vercel Environment Variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) must point to production assets.

## Frontend Hosting (Cloudflare Pages)
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables (names only):**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- **Preview Deployments:** Branch and pull request previews are configured to use staging environment variables and assets.
- **Production URL:** `https://yourbody-fyi.pages.dev` (with preview deployments at `https://<hash>.yourbody-fyi.pages.dev`).
- **Cutover Checklist (Placeholder):**
  - Vercel remains the primary production host for `www.yourbody.fyi` and `yourbody.fyi`.
  - DNS cutover is manual: any updates to DNS records pointing to Cloudflare Pages must be performed manually in Cloudflare DNS.
  - Prior to cutover, verify header parity (`public/_headers`) and CSP enforcement on the `pages.dev` deployment.

## Backend Migrations (Supabase)
- Database schema changes are version controlled in `supabase/migrations/`.
- Deploy changes via Supabase CLI:
  ```bash
  npx supabase db push
  ```
- Deploy Edge Functions:
  ```bash
  npx supabase functions deploy
  ```

## Mobile Deployment (Android)
To build and release the Yourbody APK/AAB bundle:
1. Ensure a production web build exists:
   ```bash
   npm run build
   ```
2. Sync the built assets into the Capacitor Android project:
   ```bash
   npx cap sync android
   ```
3. Open Android Studio to build the signed release bundle:
   ```bash
   npx cap open android
   ```
   Provide valid keystore credentials when generating the Signed Bundle for the Google Play Store.

## Error Reporting (Sentry)
Optional error reporting is integrated into both the web client and edge functions, activated only when an ingest DSN is configured:
- **Frontend (`VITE_SENTRY_DSN`):** Configured via Vercel environment variables. Loaded dynamically in a separate lazy chunk so that the initial bundle is unaffected when the DSN is unset. Configured with `sendDefaultPii: false`, `tracesSampleRate: 0`, no session replay, and navigation-only breadcrumbs. The `beforeSend` hook filters out browser extension errors and scrubs all request data, cookies, and user identifiers.
- **Edge Functions (`SENTRY_DSN`):** Configured via Supabase edge function secrets. Initialized only in top-level unhandled 500 error paths in edge functions. Never transmits request bodies, meal text, nutrition values, or user identifiers.
- **Privacy Guarantee:** Under no circumstances are user IDs, email addresses, meal descriptions, or nutrition quantities attached to error events.

