# TaskFlow: Deploying to Vercel

Save as `docs/DEPLOYMENT-VERCEL.md`. Vercel's features and limits change, so confirm details in the current Vercel docs before launch.

## Architecture

```
Browser
  |-- https://app.yourdomain.com  -> Vercel project "taskflow-web" (Next.js, apps/web)
  |-- https://api.yourdomain.com  -> Vercel project "taskflow-api" (Express, apps/api)
                                       |-- MongoDB Atlas
                                       |-- Redis (Upstash / Marketplace)
                                       |-- Object storage (Vercel Blob or S3/R2)
                                       |-- Queue + scheduler (QStash / Inngest / Vercel Cron)
                                       |-- Realtime provider (Pusher / Ably)
                                       |-- WhatsApp Cloud API, Payments, Email
```

## What fits Vercel and what changes

| Need            | Plain Node approach   | Vercel-friendly approach used here                              |
| --------------- | --------------------- | --------------------------------------------------------------- |
| Express API     | Long-running server   | Express exported as a Vercel Function (`export default app`)    |
| Background jobs | BullMQ workers        | `JobQueue` interface, signed HTTP job endpoints, provider queue |
| Scheduled jobs  | node-cron             | Vercel Cron hitting `/internal/cron/*` endpoints                |
| Realtime        | Socket.IO server      | `RealtimeGateway`: managed pub/sub by default                   |
| File uploads    | Multer to disk        | Presigned direct-to-storage uploads                             |
| Reports/exports | In-request generation | Async jobs plus download link                                   |

Notes from Vercel's current docs:

- Express is supported as a backend framework on Vercel.
- WebSockets on Vercel Functions are in public beta, require Fluid compute (and a permission toggle), and need rooms, presence, and pub/sub state stored externally (for example Redis). That is why the default is a managed realtime provider, with a Socket.IO adapter kept as an option once you have verified the beta suits you.
- Cron jobs invoke Vercel Functions. Hobby allows once-per-day schedules only (deploys with more frequent schedules fail); Pro allows once-per-minute. SLA escalation and WhatsApp reminders need minute-level checks, so use Pro or an external scheduler such as the queue provider's schedules.
- Vercel's Hobby plan is intended for personal, non-commercial use. A commercial product should be on Pro or higher; check the current terms.

## Vercel project setup

1. Create two projects from the same Git repository.
   - `taskflow-web`: Root Directory `apps/web`, framework Next.js.
   - `taskflow-api`: Root Directory `apps/api`, framework Express.
2. Enable "Include source files outside of the Root Directory" so `packages/shared` and `packages/config` are available during builds.
3. Use Turborepo build commands (for example `pnpm turbo run build --filter=web`).
4. Set separate environment variables per project and per environment (Production, Preview, Development). Preview deployments must never point at the production database.

## Domains and cookies

Pick one:

- **Subdomains (recommended):** `app.yourdomain.com` and `api.yourdomain.com`. Set `COOKIE_DOMAIN=.yourdomain.com` when cross-subdomain sharing is required; otherwise omit it for host-only API cookies. Phase 3a uses `__Secure-` names, `Secure`, `HttpOnly`, and `SameSite=Lax`. Configure the API CORS allowlist to the web origin and send `credentials: include`.
- **Rewrite proxy:** Next.js rewrites `/api/*` to the API project. Same-origin cookies and no CORS, at the cost of an extra hop and Next.js function usage.

Add CSRF protection for cookie-authenticated mutations in either setup.

## Environment variables (starting list)

| Project and stage                  | Variable                               | Current requirement                                                                                                               |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| API, Vercel Production and Preview | `NODE_ENV`                             | Set to `production`; the required-variable check follows `NODE_ENV`, not the Vercel environment label.                            |
| API, when `NODE_ENV=production`    | `MONGODB_URI`, `MONGODB_DB_NAME`       | Required; use a separate Atlas database and credential for Preview.                                                               |
| API, when `NODE_ENV=production`    | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Required Upstash REST pair. A Redis outage fails the general limiter open, but missing credentials fail configuration validation. |
| API, when `NODE_ENV=production`    | `WEB_ORIGIN`                           | Required exact, comma-separated web origin allowlist; configure Preview separately.                                               |
| API, local development             | `PORT`                                 | Optional, defaults to 4000. External-service variables may be omitted.                                                            |
| Web                                | `NEXT_PUBLIC_API_URL`                  | Public API base URL for the matching stage.                                                                                       |

Phase 3a adds `KEY_MASTER_V1` (at least 32 random bytes encoded base64url, distinct for Development, Preview, Production), `AUTH_ACTIVE_KEY_VERSION=1`, optional `KEY_MASTER_V2` during rotation, `JWT_ISSUER`, `JWT_AUDIENCE`, `COOKIE_DOMAIN`, `AUTH_SESSION_ABSOLUTE_DAYS` (default 30), `AUTH_SESSION_IDLE_HOURS` (default 168), `AUTH_IP_LIMIT_PER_10_MIN` (default 30), `AUTH_EMAIL_IP_LIMIT_PER_10_MIN` (default 5), `AUTH_EMAIL_DELAY_BASE_SECONDS` (default 2), `MAIL_PROVIDER=resend`, `MAIL_API_KEY`, `MAIL_FROM`, and `WEB_PUBLIC_URL`. Production-mode startup requires the master key and mail settings. The JWT key is derived from the versioned master key with HKDF; do not set a separate `JWT_ACCESS_SECRET`. `AUTH_DEV_OUTBOX=true` writes full email messages to the ignored `.dev-outbox` folder only with `NODE_ENV=development` and is rejected in Preview/Production. Later provider secrets include `CRON_SECRET`, `JOB_SIGNING_SECRET`, queue, realtime, storage, WhatsApp, payments, and error tracking credentials.

Phase 3a's local password denylist is a checked-in copy of [SecLists 10k-most-common](https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/10k-most-common.txt) plus project-specific entries. Its [MIT license](../apps/api/src/lib/SECLISTS-LICENSE.txt) is included. Confirm in an API Preview deployment that the function bundle includes `common-passwords.txt` before enabling registration; the local TypeScript build does not validate Vercel file tracing.

Zod validates on the first serverless request, while the local server validates before listening; build tooling does not need production secrets. Validation errors name variables only, and the HTTP error response stays generic. Tests clear inherited database and Upstash variables before app imports and never load `.env` files.

`WEB_ORIGIN` contains exact, comma-separated origins with no wildcard, path, or trailing slash. Credentialed CORS reflects only a listed origin and allows explicit methods and headers. Preview web deployments need a **stable branch URL alias** added to the API Preview project's `WEB_ORIGIN`; changing per-commit preview URLs will not match the allowlist. Keep Production and Preview allowlists separate. CORS is a browser policy, not API authorization.

The general `/api/v1` Upstash limiter allows 60 requests per minute per client IP and fails open during a Redis outage. Phase 3a auth routes have a separate fail-closed limiter: default 30 per IP and 5 per email/IP pair in 10 minutes, with a bounded `Retry-After` delay. Keys use purpose-separated HMACs, never raw email or IP. Vercel overwrites `X-Forwarded-For`; Express trusts one Vercel proxy hop and local Express trusts no forwarding header. Auth responses have `Cache-Control: no-store`; mutation requests use `X-CSRF-Token`. `Origin: null` is rejected.

The refresh cookie is restricted to `Path=/api/v1/auth`. `SameSite=Lax` assumes the web and API use the same site; separate Preview `vercel.app` hostnames may require a same-origin rewrite or dedicated Preview subdomains before browser auth can be accepted. A stable Preview web origin remains required in `WEB_ORIGIN`.

Phase 2 preview acceptance is pending until the deployed API's `/api/v1/health` and `/api/v1/ready` responses are recorded. Local Supertest and in-memory replica-set results do not prove Atlas connectivity or Upstash behavior in Preview.

## Cron (apps/api/vercel.json)

Phase 3b forgot-password returns 202 before account lookup; `waitUntil` keeps the email task alive on Vercel. Local Node runs it as a promise without a worker. The reset link uses `<WEB_PUBLIC_URL>/reset-password#token=...`; the browser reads the fragment and POSTs the token to the API. `AUTH_DEV_OUTBOX=true` writes email to git-ignored `.dev-outbox` only in local development, never to Pino logs. Security notification retry records contain no token or message body. A retry sweep depends on the pending scheduler decision. A user who loses both the authenticator and recovery codes cannot self-serve; a future admin-assisted reset needs out-of-band identity verification, privileged review, an audit record, session revocation, and email notice.

Define schedules in `vercel.json` under `crons`, pointing at internal endpoints, for example:

- SLA and blocker scan: every minute (Pro)
- Notification digests: daily or hourly
- Forecast refresh: hourly or nightly
- Cleanup (expired sessions, trash retention): daily

Protect every cron and job endpoint: verify the `CRON_SECRET` bearer token Vercel sends for cron calls (confirm the exact mechanism in current docs) and signatures for queue provider calls. Each run processes a bounded batch, then enqueues a continuation if work remains.

## MongoDB and serverless

- Use MongoDB Atlas (replica set). Cache the client on `globalThis`; keep `maxPoolSize` small to avoid exhausting Atlas connections when many function instances run.
- Vercel function IPs are not fixed. Use Atlas's supported integration or network option for Vercel, or an IP allowlist of `0.0.0.0/0` combined with strong credentials and TLS only if you accept that trade-off.
- Create indexes through a migration script, not at request time.

## Webhooks

WhatsApp, payments, and Git providers must get a fast response. Verify the signature, store the raw event idempotently, return 200, and process via the job queue.

## Go-live checklist

- [ ] Separate Atlas databases and credentials for production and preview
- [ ] Pro plan (or higher) for production if minute-level cron is used
- [ ] All secrets set; none in the repo or in client bundles
- [ ] Cron schedules deployed and endpoints reject unsigned calls
- [ ] Realtime provider keys set; the app degrades gracefully if it is down
- [ ] Presigned upload CORS configured on the storage bucket
- [ ] WhatsApp webhook verified, templates approved, opt-in flow tested
- [ ] Payment webhooks verified in test mode, then live
- [ ] Sentry and logging working; alerts configured
- [ ] Backups enabled and a restore tested
- [ ] Tenant isolation tests and security review passed
- [ ] Lighthouse and accessibility checks passed on key pages
