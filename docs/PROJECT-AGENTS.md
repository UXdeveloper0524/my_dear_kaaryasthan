# AGENTS.md: TaskFlow (project rules)

These rules extend the global frontend developer agent. In this project you work full stack: senior Next.js engineer and senior Node.js / Express / MongoDB engineer. If this file conflicts with the global file, this file wins.

Place this file in the repo root and rename it to `AGENTS.md`.

## Product
TaskFlow is a multi-tenant SaaS task and project management platform for companies. Signature features: Blocker engine, Request desk with SLAs, Delivery forecasting, WhatsApp-first workflow. Read `docs/MASTER-PROMPT.md` before starting any phase, and `docs/DEPLOYMENT-VERCEL.md` before touching anything that runs on a server.

## Deployment target: Vercel (critical)
Both apps deploy to Vercel as two separate projects (`apps/web`, `apps/api`). All backend code must run correctly as serverless functions:
- No long-running processes: no BullMQ workers, no `setInterval`/`node-cron`, no in-memory state shared between requests, no local disk writes (except `/tmp` scratch).
- Background work goes through the `JobQueue` interface (signed, HTTP-triggered job endpoints). Scheduled work goes through Vercel Cron or the queue provider's scheduler.
- Real-time goes through the `RealtimeGateway` interface. Never import a real-time library outside its adapter.
- Cache the MongoDB connection on `globalThis` and keep pool sizes small.
- Every request handler must finish quickly. Split long work into chunked jobs.
- File uploads go directly from the browser to object storage via presigned URLs, never through the API request body.
- Webhooks (WhatsApp, payments, GitHub) verify signatures, respond fast, and enqueue the real work.

## Monorepo layout
```
apps/api         Express API (exported as a Vercel function, plus a local dev server)
apps/web         Next.js App Router frontend
packages/shared  Zod schemas, TS types, permissions, constants, forecasting math
packages/config  shared ESLint, TSConfig, Prettier configs
docs/            MASTER-PROMPT.md, ARCHITECTURE.md, DEPLOYMENT-VERCEL.md, API.md
docker-compose.yml  local MongoDB (single-node replica set), Redis, Mailpit, MinIO
```

## Commands
```
pnpm install
docker compose up -d     # local services
pnpm dev                 # api + web via turbo
pnpm lint | pnpm typecheck | pnpm test | pnpm build
pnpm --filter api test
pnpm --filter web test:e2e
```

## Non-negotiable rules
1. **Tenancy:** every tenant-owned document has `organizationId`. All queries go through the tenant-scoped repository layer. Never accept `organizationId` from the request body or query; derive it from the authenticated session.
2. **Permissions:** enforce on the API with permission checks from `packages/shared`. The UI hides what a user cannot do, but the API is the authority.
3. **Validation:** Zod schemas live in `packages/shared` and are used by both apps. Validate every request body, query, and params.
4. **API contract:** versioned under `/api/v1`, consistent envelope `{ data, meta, error }`, cursor pagination for lists, stable error codes.
5. **Secrets:** only via environment variables, validated at startup. Never log tokens, phone numbers, message bodies, or personal data.
6. **Idempotency:** job handlers and webhook handlers must be safe to run twice.
7. **Migrations:** schema or index changes ship with a migration or index script and a note in the PR summary.
8. **Dependencies:** no new library without stating the reason, size impact, and alternatives.
9. **Scope:** small, reviewable changes per task. Do not refactor unrelated code.
10. **Git:** conventional commits. Do not commit, push, or deploy unless asked.

## Definition of done (per phase)
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass, with results reported honestly.
- New endpoints have tests (success, validation error, forbidden, cross-tenant access).
- New UI has loading, empty, error states, keyboard access, and responsive layout.
- Docs updated: API list, env vars, ER diagram where relevant.
- Final report: summary, files changed, how to verify, checks run, risks and open questions.
