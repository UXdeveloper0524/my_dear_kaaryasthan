# AGENTS.md: apps/api (Express + MongoDB, Vercel serverless)

Place this file at `apps/api/AGENTS.md`. It adds to the root project rules.

## Architecture
Layers: `routes -> controllers -> services -> repositories -> models`.
- Routes: wiring only (path, middleware chain, controller).
- Controllers: parse validated input, call one service, shape the response. No business logic.
- Services: business rules, transactions, calls to other services, queue and realtime interfaces.
- Repositories: the only layer that touches Mongoose. All tenant-scoped through a base repository that injects `organizationId`.
- Models: schemas, indexes, virtuals. Every query pattern has a supporting index.

Suggested structure:
```
src/
  app.ts            builds the Express app (no listen)
  index.ts          Vercel entry: export default app
  server.ts         local dev entry (listen)
  config/           env schema (Zod), constants
  middleware/       auth, tenant, permissions, validate, rateLimit, errorHandler, requestId
  modules/<name>/   routes, controller, service, repository, model, schemas, tests
  lib/              db (cached connection), logger, mailer, storage, crypto
  platform/         JobQueue, RealtimeGateway interfaces + adapters
  jobs/             idempotent handlers, one file per job
```

## Serverless rules
- `app.ts` must not start listeners, timers, or workers. Only `server.ts` calls `listen`.
- DB connection: create once, cache on `globalThis`, reuse across invocations; `maxPoolSize` small (for example 5); handle cold starts.
- No module-level mutable state used for correctness. Anything shared goes to MongoDB or Redis.
- Job endpoints live under `/internal/jobs/*`, verify a signature or `CRON_SECRET`, return quickly, and are idempotent. Long work is split into batches that enqueue the next batch.
- Cron endpoints do a bounded amount of work per run (for example scan 500 due items, then enqueue continuation).
- Respond to external webhooks fast; enqueue processing.

## Code standards
- TypeScript strict. No `any`. Types from `packages/shared` for contracts.
- Central error handling with custom error classes (`AppError`, `NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`). Never leak stack traces to clients.
- Structured logs with Pino; include `requestId`, `organizationId`, `userId`. Redact secrets and PII.
- Async/await only; every async route wrapped so errors reach the error handler.
- Use MongoDB transactions where multiple documents must change together (requires replica set, also locally).
- Pagination: cursor-based by default (`limit`, `cursor`), with a max limit.
- Soft delete via `deletedAt`; default queries exclude deleted documents.
- Write audit log entries for security-relevant and admin actions.

## Security
- Passwords: argon2 or bcrypt with sensible cost. Auth cookies: httpOnly, secure, SameSite as defined in the deployment doc. Refresh token rotation with reuse detection.
- Helmet, CORS allowlist from env, rate limits on auth and public endpoints, input sanitization, request size limits.
- CSRF protection for cookie-authenticated mutating requests.
- Verify webhook signatures with constant-time comparison. Store only hashed API keys.
- Check ownership and permissions in services, not only in routes.

## Testing
- Vitest + Supertest with MongoMemoryReplSet for database integration tests; reject inherited real MongoDB URIs before test imports.
- Each module tests: happy path, validation failure, unauthenticated, forbidden, and cross-tenant access (must return 404 or 403, never data).
- Pure logic (forecasting, SLA math, permission checks) gets unit tests with fixed seeds and fixed clocks.
- Run `pnpm --filter @kaaryasthan/api test` before reporting done.
