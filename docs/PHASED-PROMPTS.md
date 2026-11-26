# TaskFlow: Phased Prompts for Codex

Run phases in order. Do not start a phase until the previous one passes its acceptance criteria. Commit after every phase.

For each phase: paste **Kickoff**, review the plan, paste **Implement**, test it yourself, then paste **Close**.

## Reusable wrappers

**Kickoff**

```
Read AGENTS.md, docs/MASTER-PROMPT.md and docs/DEPLOYMENT-VERCEL.md.
We are starting Phase <N>: <name>. Plan only, no code yet. List the files to
create or change, data model changes, API endpoints, UI routes, tests, risks,
and any assumptions. Wait for my approval.
```

**Implement**

```
Approved. Implement the plan in small steps. When finished, run pnpm lint,
pnpm typecheck, pnpm test and pnpm build, and report the results honestly,
including anything you could not run.
```

**Close**

```
Review your work against the acceptance criteria of Phase <N>. List anything
unmet or unverified. Update docs (API list, ER diagram, env vars). Suggest a
conventional commit message. Do not commit.
```

---

## Phase 0: Architecture and docs (no code)

```
Produce docs only: ARCHITECTURE.md (Mermaid system diagram), ER diagram and
collection schemas with indexes, API endpoint list (/api/v1), permission
matrix by role, event catalog (for notifications, realtime, webhooks), a
mapping of every feature to the serverless constraints (jobs, cron, realtime,
uploads), env var list per Vercel project, and a phased risk register.
```

Accept when: docs are consistent with MASTER-PROMPT.md and every signature feature has a data model and endpoint list.

## Phase 1: Monorepo, tooling, local environment

```
Set up the pnpm + Turborepo monorepo (apps/web Next.js, apps/api Express,
packages/shared, packages/config). Add TypeScript strict configs, ESLint,
Prettier, Husky + lint-staged, conventional commits, env validation with Zod,
docker-compose.yml (MongoDB single-node replica set, Redis, Mailpit, MinIO),
.env.example files, a CI workflow (lint, typecheck, test, build), and the
Vercel project configuration for apps/web and apps/api.
```

Accept when: `pnpm dev` runs both apps; CI passes; a shared Zod schema is imported by both apps. For local services, either `docker compose up -d` starts the Compose stack or the API connects to a development Atlas cluster with `GET /api/v1/ready` returning 200. Do not use a production database for local development.

## Phase 2: API foundation

```
Build the API foundation: app.ts (no listen) exported for Vercel plus a local
server.ts, config, Pino logging with request IDs, error classes and central
error handler, Zod validation middleware, response envelope, cached MongoDB
connection on globalThis, health endpoints, Redis rate limiting, helmet and
CORS allowlist, OpenAPI setup, and the test harness (Vitest, Supertest,
replica-set MongoDB for tests).
```

Accept when: health check passes locally and in a Vercel preview; repeated requests reuse the DB connection; tests run green.

## Phase 3a: Authentication core (API only)

```
Implement shared auth contracts, versioned HKDF/HMAC/encryption utilities,
Argon2id password hashing, global user/session/refresh/auth token collections,
index migrations, register, email verification and resend, login, logout,
refresh rotation, GET /auth/me, session/device list and revoke, CSRF,
fail-closed auth limits, audit events, and Mailer adapters. JWT access expires
in 15 minutes. A used refresh token returns retryable 409 during the first
10 seconds; later reuse revokes its family. No organizations or roles yet.
```

Accept when: API tests cover refresh races and reuse, expiry, JWT algorithm, cookies, CSRF, rate limits, encrypted lookup, index behavior, and cross-user session access. Lint, typecheck, tests, and build pass. Preview and Atlas-dev migration checks remain separate deployment gates.

## Phase 3b: Account recovery and MFA (later)

```
Add forgot/reset and change-password, TOTP 2FA and single-use recovery codes.
Reset tokens expire in one hour; issuing a new token invalidates older ones.
Add provider-backed email delivery checks and security audit tests. Google and
Microsoft OAuth are optional later work.
```

Accept when: recovery and MFA flows pass API integration tests and Preview delivery checks without exposing tokens or account existence.

## Phase 4: Tenancy, organizations, RBAC

```
Implement multi-tenancy and RBAC: tenant-scoped base repository that injects
organizationId, organizations, departments, teams, memberships, roles and
granular permissions in packages/shared, invitations by email, user
deactivation, profiles (timezone, working hours, availability). Add tests
proving cross-tenant access is impossible for every endpoint.
```

Accept when: a user from org A cannot read or write any org B data in any module; permission checks are covered by tests.

## Phase 5: Projects and workflows

```
Implement projects (create, archive, clone, templates, visibility, members and
roles), custom workflows and statuses, sprints, milestones, labels, custom
field definitions, and goals/OKRs, with tests and OpenAPI docs.
```

Accept when: project templates and clone work; workflow changes do not orphan tasks.

## Phase 6: Task core

```
Implement tasks: CRUD, subtasks, checklists, dependencies with cycle
detection, multiple assignees, watchers, priority, labels, estimates, dates,
custom field values, recurring tasks, task templates, bulk actions, ordering
with fractional indexing, comments with mentions and reactions, activity
history, attachments via presigned uploads, time tracking (timer and manual),
full-text search, and saved filters. Cursor pagination on all lists.
```

Accept when: dependency cycles are rejected; ordering survives concurrent moves; uploads never pass through the API body.

## Phase 7: Jobs, realtime, notifications

```
Create the JobQueue and RealtimeGateway interfaces with adapters (queue
provider adapter, managed pub/sub adapter, and an in-process dev adapter).
Add signed /internal/jobs/* endpoints, retry/backoff and dead-letter handling,
the notification center (in-app and email), per-user preferences, and
digests triggered by Vercel Cron. Publish task events to realtime channels.
```

Accept when: jobs are idempotent (run twice, same result); job and cron endpoints reject unsigned calls; no code outside adapters imports provider SDKs.

## Phase 8: Blocker engine

```
Implement the Blocker engine per MASTER-PROMPT.md: blocker model and
endpoints, escalation policies, SLA evaluation via cron plus delayed jobs,
rule to prevent completing tasks with open blockers, auto-resolution of
dependency blockers, notifications, and analytics endpoints (time blocked,
top blockers, wait times).
```

Accept when: escalation steps fire once each at the right thresholds in tests with a fixed clock; resolving a blocker notifies the owner.

## Phase 9: Request desk and SLA engine

```
Implement the Request desk: request types with form schema, routing and
assignment strategies, single/multi-step/parallel approvals with delegation,
SLA policies with business-hours calendars, timezones, holidays and pause
rules, breach warnings and escalations, request-to-task linking, CSAT, and
reports. SLA math must be a pure, unit-tested function.
```

Accept when: SLA due dates are correct across timezones, weekends, and holidays; paused time is excluded; approvals handle rejection and delegation.

## Phase 10: Delivery forecasting

```
Implement forecasting in packages/shared as pure deterministic functions
(seedable RNG): Monte Carlo over historical cycle times or throughput,
per-assignee estimation bias, blocked-task and WIP adjustments, P50/P80/P95
output, confidence labels, risk drivers, and scenario comparison. Add
chunked jobs that store forecastSnapshots, endpoints, and unit tests with
fixed seeds.
```

Accept when: results are reproducible with a seed; low-history projects are labeled low confidence; computation fits within function time limits via chunking.

## Phase 11: WhatsApp integration

```
Implement WhatsApp via the Cloud API: phone linking with OTP, opt-in and
opt-out, webhook with signature verification and message de-duplication,
fast 200 then enqueue, command grammar (new, my tasks, done, block, log),
interactive messages, outbound templates and nudges, rate limiting, and a
mock adapter for tests. Do not log message bodies.
```

Accept when: replayed webhooks do not create duplicate tasks; invalid signatures are rejected; commands are covered by tests.

## Phase 12: Web foundation

```
Build the Next.js foundation: route groups ((auth), (app), (admin), (portal)),
middleware route protection, auth screens with 2FA, app shell, design system
on shadcn/ui, typed API client using shared Zod schemas, TanStack Query
setup, RealtimeProvider, i18n, dark/light mode, and error and loading
boundaries.
```

Accept when: unauthenticated users are redirected server-side; the whole auth flow works end to end; Lighthouse accessibility is 90+.

## Phase 13: Task experience (web)

```
Build the task UI: board with dnd-kit (keyboard accessible), list, table,
calendar, task detail drawer with comments, mentions, attachments, time
tracking, dependencies and activity, filters and saved views, command
palette (Cmd/Ctrl+K), optimistic updates with rollback, and live updates
from realtime events.
```

Accept when: two browsers see each other's changes live; failed moves roll back visibly; all of it is usable with the keyboard only.

## Phase 14: Signature feature UIs (web)

```
Build UIs for: blockers (raise dialog, chips, Waiting on me / on others, Stalled
work dashboard), request desk (portal, request builder, approvals inbox, SLA
timers, reports), delivery forecast (P50/P80/P95 chart, risk drivers, scenario
comparison), and WhatsApp settings (link phone, preferences, message log).
```

Accept when: each feature has empty, loading, and error states and passes Playwright flows.

## Phase 15: Planning and analytics (web)

```
Build backlog and sprint planning, sprint board, burndown and velocity,
Gantt/timeline (dynamic import), workload view, dashboards, reports with
asynchronous CSV/Excel/PDF export (job + download link), and scheduled
reports.
```

Accept when: large projects stay responsive; exports are generated by jobs, not blocking requests.

## Phase 16: Automation, API, integrations

```
Implement the automation rule engine (trigger, conditions, actions, run logs),
outgoing webhooks with signing and retries, public REST API with hashed API
keys and scopes, CSV/JSON import and export, Slack/Teams, Google Calendar,
GitHub/GitLab integrations, and email-to-task. Add loop protection to
automations.
```

Accept when: automation loops are prevented; webhook deliveries retry and show status; API keys are stored hashed.

## Phase 17: Administration and billing

```
Implement the admin panel (users, roles, audit logs, usage), branding,
custom fields manager, data retention, trash and restore, plans and
seat-based billing with Stripe and Razorpay adapters, webhooks, usage
metering, plan limits enforcement, onboarding flow, and tenant data export.
```

Accept when: plan limits are enforced server-side; payment webhooks are idempotent and signature-verified.

## Phase 18: Hardening and launch

```
Prepare for launch: Playwright E2E for critical flows, security review against
OWASP Top 10 and tenant isolation, dependency audit, load test of key
endpoints, accessibility audit, Sentry and logging, Vercel deployment
(env vars, domains, cookies, cron schedules), backups and restore test,
runbook, README, and API documentation.
```

Accept when: staging passes the full checklist in docs/DEPLOYMENT-VERCEL.md and a restore from backup has been tested.

---

## Prompts for day-to-day fixes

- **Bug:** `Reproduce this bug first, explain the root cause, fix it minimally, add a regression test, run the checks.`
- **Review:** `Review the current git diff for tenant isolation, permission checks, serverless violations, missing tests and accessibility. Report findings only; do not change code.`
- **Performance:** `Profile <endpoint or page>. Find the biggest cost first (queries, indexes, bundle size), fix it, and report before/after numbers.`
