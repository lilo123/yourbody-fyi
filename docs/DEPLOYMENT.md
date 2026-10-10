# Deployment Architecture & Operational Runbook

This document describes the continuous deployment (CD) architecture, staging and production pipelines, secret management, verification gates, and emergency rollback procedures for the application.

---

## 1. Overview & Pipeline Philosophy

The deployment workflow enforces three key operational principles:
1. **Zero Downtime Database Migrations (Expand-Only):** Database schema changes must follow expand-and-contract patterns. Columns, tables, and constraints are added in backward-compatible migrations. Database migrations are never rolled back; fixes forward ensure schema consistency.
2. **Pre-Deploy Encrypted Backups:** Before any migration or function change reaches production, an encrypted database dump (roles, schema, and data) is captured and pushed to a secure operations repository. Plaintext dumps are never persisted to disk or published as workflow artifacts.
3. **Automated End-to-End Verification:** Production deployments run real browser smoke tests against the live endpoint before a release tag is minted.

---

## 2. Workflows & Trigger Architecture

### Staging Deployment (`.github/workflows/deploy-staging.yml`)
- **Trigger:**
  - Pull requests targeting `main` touching `supabase/**` or `.github/workflows/deploy-staging.yml`.
  - Manual trigger via `workflow_dispatch`.
- **Security & Concurrency:**
  - Standard pull request trigger with job guard `github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository` (fork executions are rejected).
  - Serialized via concurrency group `staging-deploy` (`cancel-in-progress: false`).
  - Read-only repository token permissions (`contents: read`).
  - Fail-safe secret preflight: If staging secrets are not yet configured on the repository, the workflow completes with a notice and skips subsequent steps, keeping pull request status checks green.
- **Execution Order:**
  1. Check staging secrets configuration.
  2. Pinned repository checkout (`actions/checkout`).
  3. Install the pinned Supabase CLI (`supabase/setup-cli`, same version as CI).
  4. Link to staging Supabase project via project ref.
  5. Push database migrations (`supabase db push`).
  6. Deploy edge functions (`supabase functions deploy --use-api`).
  7. Print remote migration status (`supabase migration list`).

### Production Deployment (`.github/workflows/deploy-production.yml`)
- **Trigger:**
  - Push to `main`.
  - Manual trigger via `workflow_dispatch` with optional `skip_db_push` boolean input (used during edge function rollbacks from older commits).
- **Activation Gate:**
  - The entire workflow is guarded by the repository variable `vars.PROD_DEPLOY_ENABLED == 'true'`. Until this variable is explicitly configured, all runs are inert.
- **Environment & Concurrency:**
  - Configured with GitHub Actions environment `production` (enabling required reviewers and environment-level secrets).
  - Serialized via concurrency group `production-deploy` (`cancel-in-progress: false`).
- **Execution Order:**
  1. **Preflight Check:** Verifies presence of all required production secrets; fails fast if any are missing.
  2. **Tool Installation:** Installs `age` encryption utility from a pinned GitHub release, verified against a cryptographic SHA-256 digest.
  3. **Pre-deploy Backup:**
     - Links production project via Supabase CLI.
     - Dumps cluster roles (`--role-only`), schema, and data (`--data-only --use-copy`) to a secure temporary directory.
     - Creates an uncompressed archive and encrypts using `age -r "$AGE_RECIPIENT"`.
     - Deletes plaintext files immediately via shell `trap` handler.
  4. **Backup Archival:**
     - Clones the private operations repository (`yourbody-ops`) with shallow depth using authenticated header credentials without leaking tokens.
     - Commits the encrypted archive under `predeploy/<timestamp>-<sha>.tar.age` with bot identity.
  5. **Database & Backend Deployment:**
     - Applies pending migrations (`supabase db push`) unless `skip_db_push` is specified.
     - Deploys all edge functions (`supabase functions deploy --use-api`).
  6. **Frontend Deployment & Rollout Wait:**
     - Triggers deployment hook (if `VERCEL_DEPLOY_HOOK_PROD` is configured).
     - Polls `https://www.yourbody.fyi/version.json` (no cache) every 15 seconds (up to 15 minutes) until the live `sha` matches the deployed commit SHA.
  7. **Smoke Testing:**
     - Installs Playwright Chromium.
     - Executes `playwright.smoke.config.ts` verifying real authentication, set logging/deletion, and nutrition parsing.
  8. **Release Tagging (Separate Job):**
     - Runs with `contents: write` only after the deployment and smoke tests pass.
     - Creates and pushes an annotated tag `vYYYY.MM.DD-N` to the repository.

---

## 3. Configuration & Secrets Matrix

Secrets and variables must be configured in GitHub repository settings:

### Repository Secrets (Staging)
| Secret Name | Purpose |
|-------------|---------|
| `SUPABASE_ACCESS_TOKEN_STAGING` | Personal access token for Supabase Management API. |
| `STAGING_PROJECT_REF` | Reference identifier for the staging Supabase project. |
| `STAGING_DB_PASSWORD` | Database user password for staging PostgreSQL. |

### Environment Secrets (`production`)
| Secret Name | Purpose |
|-------------|---------|
| `SUPABASE_ACCESS_TOKEN_PROD` | Personal access token for Supabase Management API. |
| `PROD_PROJECT_REF` | Reference identifier for the production Supabase project. |
| `PROD_DB_PASSWORD` | Database user password for production PostgreSQL. |
| `AGE_RECIPIENT` | Public recipient key (`age1...`) used to encrypt database backups. |
| `OPS_REPO_TOKEN` | Fine-grained GitHub PAT with `contents:write` on the private ops repository. |
| `SMOKE_EMAIL` | Credentials for dedicated automated smoke verification user. |
| `SMOKE_PASSWORD` | Password for automated smoke verification user. |
| `VERCEL_DEPLOY_HOOK_PROD` | *(Optional)* Webhook URL to trigger production frontend build. |

### Repository Variables
| Variable Name | Purpose |
|---------------|---------|
| `PROD_DEPLOY_ENABLED` | Set to `'true'` to activate production deployment. Default is unset / inert. |

---

## 4. Rollback Procedures

### Frontend Rollback
- Since the frontend is decoupled, use the hosting provider dashboard's **Instant Rollback** to immediately revert to the previous working deployment.
- Alternatively, revert the commit on `main` and trigger standard deployment.

### Edge Function Rollback
- If an edge function deployment introduces an issue, trigger the Production Deploy workflow manually via `workflow_dispatch`:
  - Select the Git ref / commit of the previous known stable version.
  - Set `skip_db_push` to `true`.
- Setting `skip_db_push` ensures that Supabase CLI does not fail trying to push migrations from an older commit when the remote database already has newer migrations applied.

### Database Schema (Expand-Only)
- **The database is never rolled back.**
- All migrations are designed to be strictly backward-compatible (expand-only):
  - New columns are added as nullable or with safe defaults.
  - Columns or tables are deprecated in code before being dropped in future migrations.
  - If a migration contains a bug, deploy a forward fix migration that rectifies the schema.

---

## 5. Operations Repository & Disaster Recovery

The private operations repository (`lilo123/yourbody-ops`) provides automated disaster recovery controls:
- **Nightly Offsite Backups:** Runs daily at 03:17 UTC via the database session pooler, encrypting full dumps with `age` and archiving artifacts with 14-day retention.
- **Database Keep-Alive:** Daily lightweight health check preventing database pause on inactive tiers.
- **Restore Drills:** a manually triggered workflow takes a fresh production dump, restores it into the empty staging project, and compares per-table row counts against the dump, recording the duration of each phase. It refuses to run when the staging URL points at production or when staging is not empty, and it prints only table names, counts, and timings.
- **Staging Reset:** a manually triggered, confirmation-gated workflow empties staging after a drill so no production data remains there. Staging is then rebuilt by the staging deploy workflow.
- **Backup decryption check:** the age private key is kept offline and never stored in CI. The maintainer can confirm that a nightly artifact decrypts with `age -d -i <key file> backup-*.tar.age | tar -tv`.

---

## 6. Edge Function Runtime Secrets

Edge functions read their runtime configuration from the Supabase project they run in, not from GitHub. Set these in each project (staging and production) under Edge Functions → Secrets, or with `supabase secrets set`:

| Name | Purpose |
|------|---------|
| `GEMINI_API_KEY` | API key used by `parse-nutrition`. Use a separate key for staging. |
| `GEMINI_MODEL_ID`, `GEMINI_VISION_MODEL_ID` | *(Optional)* Model overrides. |
| `ALLOWED_ORIGINS` | *(Optional)* Comma-separated extra CORS origins. |
| `ENVIRONMENT` | Set to `production` in production to disable localhost origins. |

---

## 7. Preview Deployments

Every pull request gets a preview deployment from the hosting provider. Previews are built with the **staging** Supabase project, so testing on a preview never touches production data.

| Setting | Where | Value |
|---------|-------|-------|
| `VITE_SUPABASE_URL` | Hosting provider env vars, **Preview** only | Staging project URL |
| `VITE_SUPABASE_ANON_KEY` | Hosting provider env vars, **Preview** only | Staging publishable (anon) key |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Hosting provider env vars, **Production** only | Production values |
| Auth redirect URLs | Staging project → Authentication → URL Configuration | The preview host pattern |
| `GEMINI_API_KEY` | Staging project → Edge Functions → Secrets | A key separate from production |

Notes:
- Both `VITE_*` values are public by design: they are embedded in the browser bundle, and data access is enforced by row-level security. Never place a secret or service-role key in a `VITE_*` variable.
- Edge functions accept preview origins through `supabase/functions/_shared/cors.ts`. Per-deployment preview hosts are matched by a pattern anchored on the hosting team suffix.
- When a pull request changes `supabase/**`, the staging deploy workflow applies its migrations and functions to staging, so the preview runs against the matching backend.
- To check that a preview uses staging, fetch the preview's main JavaScript bundle and confirm it references the staging project host and not production.
