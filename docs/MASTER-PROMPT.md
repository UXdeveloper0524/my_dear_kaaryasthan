# TaskFlow: Master Product Prompt

Save as `docs/MASTER-PROMPT.md`. Codex reads it at the start of every phase (see PHASED-PROMPTS.md).

## Role
Act as a Senior Full-Stack Architect and Developer with 15+ years of experience building enterprise SaaS (Next.js, Node.js/Express, MongoDB). You follow clean architecture, SOLID, secure coding (OWASP Top 10), and write tested, maintainable code.

## Product
**TaskFlow** (working name): a multi-tenant, company-wide task and project management platform, competitive with Asana, ClickUp, and Jira, differentiated by four signature features. It will be sold as a product, so tenancy, billing, onboarding, and admin are first-class.

## Stack
- Monorepo: pnpm workspaces + Turborepo (`apps/web`, `apps/api`, `packages/shared`, `packages/config`)
- Web: Next.js (latest stable, App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query, Zustand (light client state), React Hook Form + Zod, dnd-kit, Recharts, Tiptap (rich text), next-intl, next-themes
- API: Node.js LTS, Express, TypeScript, Mongoose, MongoDB Atlas (replica set), Zod, Pino, OpenAPI docs
- Platform adapters (interfaces with swappable implementations):
  - `JobQueue` (delayed and background jobs via signed HTTP job endpoints; provider such as QStash or Inngest)
  - `RealtimeGateway` (managed pub/sub such as Pusher or Ably by default; Socket.IO on Vercel WebSockets as an optional adapter)
  - `Storage` (presigned uploads to Vercel Blob or S3/R2)
  - `Mailer` (SMTP/Resend/SES)
  - `Payments` (Stripe and Razorpay adapters)
  - `Messaging` (WhatsApp Cloud API adapter)
- Redis (Upstash or Marketplace Redis) for rate limiting, caching, locks
- Testing: Jest + Supertest, Vitest + React Testing Library, Playwright
- Deployment: Vercel (two projects), see `docs/DEPLOYMENT-VERCEL.md`. Local dev: Docker Compose.

## Architecture constraints (serverless-first)
Everything on the API side must run as stateless serverless functions: no persistent workers, no in-memory shared state, short request handlers, idempotent jobs, signed webhook and cron endpoints, cached DB connections, direct-to-storage uploads. Design every feature with this in mind.

## Domain model (MongoDB collections, all tenant-scoped with `organizationId` unless noted)
organizations, users (global), memberships (user, org, role), departments, teams, projects, workflows (statuses per project), sprints, milestones, tasks, comments, attachments, timeEntries, activityLogs, notifications, notificationPreferences, savedFilters, customFieldDefinitions, blockers, escalationPolicies, requestTypes, requests, approvals, slaPolicies, businessCalendars, forecastSnapshots, automationRules, webhooks, apiKeys, integrations, whatsappLinks, whatsappMessages, auditLogs, plans/subscriptions, usageCounters.
Define indexes for every query pattern; include `organizationId` as the leading field of tenant indexes.

## Signature features

### 1. Blocker / "waiting-on" engine
A blocker is a first-class object, not a status label.
- Fields: task, type (person, team, external party/client/vendor, other task, approval), waitingOn reference, reason, createdBy, since, expected resolution date, SLA hours, status (open, resolved, cancelled), resolution note.
- Escalation ladder per org/project (policy): at configurable percentages of the SLA, remind the waiting-on person, notify task owner and manager, then flag on a leadership "Stalled work" view. Each step records an event.
- Rules: optional setting to prevent completing a task with open blockers; unblocking notifies the owner; dependency blockers resolve automatically when the blocking task is done.
- Analytics: time blocked by person/team/external party, top blockers, average wait times, cost of blocked time (if cost rates exist).
- UI: raise-blocker dialog, blocker chips on cards and rows, "Waiting on me" and "Waiting on others" views, stalled work dashboard.

### 2. Request desk with SLAs
Cross-department requests (HR, IT, Finance, Facilities, client requests) in one system linked to tasks.
- Request types with a builder for custom form schemas (field types, validation, conditional fields).
- Routing rules (by type, department, field values), assignment strategies (manual, round-robin, least-loaded).
- Approvals: single, multi-step, and parallel approvers; approve/reject with comments; delegation when approver is away.
- SLA policies: first-response and resolution targets, business-hours calendars with timezone and holidays, pause when waiting on requester, breach warnings and escalations.
- Requester portal (employees) and optional public form with spam protection; status tracking; CSAT after resolution.
- Convert request to task and keep both linked; resolution syncs both ways.
- Reports: volume, SLA compliance, time to resolution per department.

### 3. Delivery forecasting
Probabilistic delivery dates instead of a single guess.
- For a project, sprint, milestone, or selected task set: forecast completion as P50 / P80 / P95 dates.
- Method: Monte Carlo simulation (about 10,000 runs) bootstrapped from historical cycle times or throughput of the relevant team, assignee, and task type; adjust for per-person estimation bias (actual vs estimated); account for blocked tasks and work in progress.
- Show a confidence label (low when history is insufficient, for example fewer than 20 completed tasks), explain the main risk drivers (blocked tasks, unestimated tasks, scope growth), and let users compare scenarios ("what if we add 5 tasks / remove 1 person").
- Compute in a chunked, idempotent job, store a `forecastSnapshot`, and chart forecast changes over time. The math lives in `packages/shared` as pure, deterministic functions (seedable RNG) with unit tests.

### 4. WhatsApp-first workflow
Staff work from WhatsApp using the WhatsApp Business Cloud API (verify Meta's current policies, message-template rules, and pricing before launch).
- Link a user's phone to their account with OTP verification. Per-user opt-in and opt-out. Per-organization WhatsApp configuration.
- Inbound commands with a deterministic grammar first, for example: `new: Fix invoice bug @Ravi tomorrow`, `my tasks`, `done 123`, `block 123 waiting on client`, `log 2h on 123`. Interactive buttons and lists for status updates and confirmations.
- Outbound: assignment alerts, due and overdue reminders, SLA warnings, blocker nudges, daily digest. Use approved templates outside the 24-hour customer-service window.
- Webhook: verify `X-Hub-Signature-256`, respond quickly, deduplicate by message ID, enqueue processing. Rate limit per user and per org. Log messages without storing more personal data than needed.
- Optional: natural-language parsing behind an interface, with the user confirming before any write.

## Core features
1. **Auth and security:** register/login/logout, refresh rotation, forgot/reset password, email verification, TOTP 2FA, session and device management, SSO-ready design (Google/Microsoft OAuth), rate limiting, helmet, CORS allowlist, CSRF protection, audit logs.
2. **Organization and RBAC:** Organization > Departments > Teams > Members. Roles: Owner, Admin, Manager, Team Lead, Member, Guest/Client. Granular permissions defined in `packages/shared`, invitations, deactivation, profiles, timezone, working hours, availability and leave.
3. **Projects:** create, archive, clone, templates, visibility (private/team/organization), members and roles, milestones, sprints, goals/OKRs, custom workflows and statuses.
4. **Tasks:** subtasks, checklists, dependencies (blocks / blocked by), related tasks, rich-text description, multiple assignees, reporter, priority, labels, story points, estimates, start/due dates, custom fields, recurring tasks, task templates, bulk actions, drag-and-drop ordering (fractional indexing), comments with @mentions and reactions, attachments, activity history, watchers, time tracking (timer and manual), cost rates.
5. **Views:** board, list, table, calendar, Gantt/timeline, workload, backlog, sprint board, burndown and velocity, saved filters, full-text search, grouping, "My Work" dashboard, global command palette (Cmd/Ctrl+K).
6. **Collaboration and notifications:** realtime board updates, presence, project discussions, wiki/docs per project, in-app and email notifications, per-user preferences, digests.
7. **Automation and integrations:** rule engine (trigger, conditions, actions), outgoing webhooks, public REST API with API keys, Slack/Teams, Google Calendar, GitHub/GitLab, CSV/JSON import and export, email-to-task.
8. **Reporting:** completion rate, overdue, workload, time spent, cycle time, cumulative flow, project health, exports (CSV/Excel/PDF generated asynchronously), scheduled reports.
9. **Administration and SaaS:** admin panel, audit logs, branding, custom fields manager, data retention, trash and restore, plans and billing (Stripe and Razorpay), seat-based limits, usage metering, onboarding flow, data export for tenants.
10. **UX:** responsive, WCAG 2.1 AA, dark/light, keyboard shortcuts, i18n-ready, optimistic UI, skeletons, error boundaries, PWA.

## Non-functional requirements
- Security: OWASP Top 10, strict tenant isolation (tests required), least privilege, secrets in env only, dependency audit in CI.
- Performance: indexed queries, pagination everywhere, caching where measured, p95 API latency target under 300 ms for common reads, lazy-loaded heavy UI.
- Reliability: idempotent jobs and webhooks, retries with backoff, dead-letter handling, graceful degradation if realtime or WhatsApp is down.
- Observability: structured logs, error tracking (Sentry), request IDs, basic metrics, audit trail.
- Quality: strict TypeScript, ESLint, Prettier, conventional commits, test coverage on business logic, E2E on critical flows.

## Working agreement
Work phase by phase (see PHASED-PROMPTS.md). For each phase: plan first, wait for approval, implement in small steps, run lint/typecheck/test/build, report honestly what was and was not verified, update docs. Flag assumptions and ask when a wrong guess would be expensive.
