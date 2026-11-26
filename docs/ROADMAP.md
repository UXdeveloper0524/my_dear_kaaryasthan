# Roadmap and risks

This is the **design order**, not a claim that every earlier phase is currently complete. The repository already has a monorepo and a partial API foundation; Phase 0 is being refreshed for review. Each phase needs its acceptance checks, documentation update, and an explicit request before commit, push, or deployment.

| Order | Phase                  | Deliverable and exit gate                                                                                                                     |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Architecture           | Review these six docs; signature features have models, endpoints, permissions, events, and Vercel execution paths                             |
| 1–2   | Foundation             | Monorepo and cloud development setup; API health, validation, logging, cached Atlas connection, Redis limit; Preview build and readiness pass |
| 3–4   | Auth and tenancy       | Cookie sessions and refresh rotation, then tenant repositories and RBAC; auth and cross-tenant tests pass                                     |
| 5–6   | Work core              | Projects, workflows, sprints, tasks, dependencies, comments, direct uploads; cycle and concurrent-order tests pass                            |
| 7     | Jobs and realtime      | Signed idempotent jobs, notification inbox, managed realtime adapter; replay and unsigned-call tests pass                                     |
| 8     | Blockers               | Escalation ladder, completion rule, analytics; fixed-clock escalation fires once                                                              |
| 9     | Request desk           | Form types, routing, approvals, business-calendar SLA; timezone, holiday, pause, and delegation tests pass                                    |
| 10    | Forecasting            | Seeded pure math and chunked snapshot jobs; deterministic P50/P80/P95 and low-history labels pass                                             |
| 11    | WhatsApp               | Consent, signed webhook, deduplication, commands, templates; replay and signature tests pass                                                  |
| 12–14 | Web product            | Auth flow, accessible app shell, task views, blocker/request/forecast/WhatsApp screens; responsive and keyboard E2E pass                      |
| 15    | Planning and analytics | Backlog, workload, reports, asynchronous exports; large-project performance and export job checks pass                                        |
| 16–17 | Automation and SaaS    | Rules, integrations, signed webhooks, API keys, admin, billing, limits; loop and webhook replay tests pass                                    |
| 18    | Hardening and launch   | Security, tenant isolation, accessibility, load, backups/restore, alerts, runbook; staging checklist and restore drill pass                   |

## Risk register

| Phase | Risk                                                           | Mitigation or decision gate                                                            |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1–2   | Vercel monorepo build, Atlas access, or Preview config fails   | Keep separate Preview credentials; prove build and /api/v1/ready before feature work   |
| 3–4   | Cookie, CSRF, or tenant-scope leak                             | Server-side authorization, rotation/reuse detection, cross-tenant test for every route |
| 5–7   | Concurrent ordering, duplicate jobs, or missing realtime event | Version checks, fractional rank strategy, durable outbox and idempotency receipts      |
| 8–9   | Escalation or SLA wrong across timezones/holidays              | Pure clock-driven functions, fixed-clock tests, explicit business calendar             |
| 10    | Forecast looks more certain than evidence supports             | Seeded runs, confidence labels, history threshold, visible risk drivers                |
| 11    | WhatsApp consent, template, or policy failure                  | Consent records, verified signatures, provider-policy review before launch             |
| 12–15 | Dense UI loses readability, accessibility, or performance      | Brand tokens, WCAG AA, keyboard and mobile checks, lazy heavy views                    |
| 16–18 | Automation loops, billing replay, export timeout, or data loss | Loop guards, signed idempotent webhooks, bounded export jobs, backup restore drill     |

Near-term sequence after Phase 0 review: close the Vercel API build issue, configure isolated Preview Atlas data, verify Preview health/readiness, then complete Phase 2's remaining acceptance checks. Later provider choices remain open until their phase; do not turn placeholders into production commitments.
