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
| Need | Plain Node approach | Vercel-friendly approach used here |
|---|---|---|
| Express API | Long-running server | Express exported as a Vercel Function (`export default app`) |
| Background jobs | BullMQ workers | `JobQueue` interface, signed HTTP job endpoints, provider queue |
| Scheduled jobs | node-cron | Vercel Cron hitting `/internal/cron/*` endpoints |
| Realtime | Socket.IO server | `RealtimeGateway`: managed pub/sub by default |
| File uploads | Multer to disk | Presigned direct-to-storage uploads |
| Reports/exports | In-request generation | Async jobs plus download link |

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
- **Subdomains (recommended):** `app.yourdomain.com` and `api.yourdomain.com`. Set auth cookies with `Domain=.yourdomain.com`, `Secure`, `HttpOnly`, `SameSite=Lax`. Configure the API CORS allowlist to the web origin and send `credentials: include`.
- **Rewrite proxy:** Next.js rewrites `/api/*` to the API project. Same-origin cookies and no CORS, at the cost of an extra hop and Next.js function usage.

Add CSRF protection for cookie-authenticated mutations in either setup.

## Environment variables (starting list)
API: `NODE_ENV`, `MONGODB_URI`, `MONGODB_DB_NAME`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `WEB_ORIGIN`, and later auth/provider secrets (`JWT_ACCESS_SECRET`, `COOKIE_DOMAIN`, `CRON_SECRET`, `JOB_SIGNING_SECRET`, `QUEUE_PROVIDER_*`, `REALTIME_PROVIDER_*`, `STORAGE_*`, `MAIL_*`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `STRIPE_*`, `RAZORPAY_*`, `SENTRY_DSN`).
Web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_REALTIME_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SESSION_*` for any server-side needs.
In Production, the API requires `MONGODB_URI`, `MONGODB_DB_NAME`, `WEB_ORIGIN`, `KV_REST_API_URL`, and `KV_REST_API_TOKEN`. Zod validates on the first serverless request, while the local server validates before listening; build tooling does not need production secrets. Validation errors name variables only. Local development and tests may omit external-service variables.

`WEB_ORIGIN` contains exact, comma-separated origins with no wildcard, path, or trailing slash. Credentialed CORS reflects only a listed origin and allows explicit methods and headers. Preview web deployments need a **stable branch URL alias** added to the API Preview project's `WEB_ORIGIN`; changing per-commit preview URLs will not match the allowlist. Keep Production and Preview allowlists separate. CORS is a browser policy, not API authorization.

The general `/api/v1` Upstash limiter allows 60 requests per minute per client IP. It fails open when Redis is unavailable so health/readiness and ordinary API requests remain reachable; the outage is logged without raw IPs. Add a separate fail-closed auth limiter in Phase 3 before exposing login or reset endpoints. Vercel overwrites `X-Forwarded-For`; Express trusts one Vercel proxy hop and the limiter hashes `req.ip`. Local Express trusts no forwarding header.

## Cron (apps/api/vercel.json)
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
