# API contract

Base path: /api/v1. The foundation and Phase 3a auth routes below are implemented; later module routes are planned. Ordinary API responses use { data, meta, error }, while **GET /api/v1/openapi.json** returns the raw OpenAPI document. Errors have stable codes and an x-request-id header. Phase 3a sessions are global with `activeOrganizationId: null`; organization selection begins in Phase 4.

## Live Phase 2 routes

| Method and path          | Successful response               | Other current behavior                                                  |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------------- |
| GET /api/v1/health       | 200 envelope with status `ok`     | 400 VALIDATION_ERROR for unexpected query parameters; no database check |
| GET /api/v1/ready        | 200 envelope after a MongoDB ping | 503 DATABASE_UNAVAILABLE if the database cannot be reached              |
| GET /api/v1/openapi.json | 200 raw OpenAPI 3.0 document      | The only unwrapped successful response                                  |

## Phase 3a auth routes

All routes below begin `/api/v1/auth`, return `Cache-Control: no-store`, and use shared Zod schemas where they take JSON input. Access credentials are 15-minute HS256 JWTs in `HttpOnly` cookies; opaque refresh tokens rotate. Obtain a CSRF token from `GET /csrf`, send it as `X-CSRF-Token` on mutations, and obtain a new CSRF token after login. Cookies are sent with `credentials: include`.

| Route                       | Request                        | Successful response                                                                                                                |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET /csrf                   | No body                        | `{csrfToken}` and signed CSRF cookie                                                                                               |
| POST /register              | `{email,password,displayName}` | 202 `{accepted:true}` for new or existing email; existing email receives an account notice                                         |
| POST /verify-email/resend   | `{email}`                      | 202 `{accepted:true}`                                                                                                              |
| POST /verify-email          | `{token}`                      | 200 `{verified:true}`; token expires after 24 hours and only newest token works                                                    |
| POST /login                 | `{email,password}`             | 200 `{user,session}` and access/refresh cookies; unverified correct credentials receive 403 `EMAIL_NOT_VERIFIED`                   |
| POST /refresh               | Refresh cookie                 | 200 `{user,session}` and rotated cookies; used token within 10 seconds returns 409 `REFRESH_RETRY`, later reuse revokes the family |
| POST /logout                | Cookies                        | 200 `{loggedOut:true}` and cleared cookies                                                                                         |
| GET /me                     | Access cookie                  | 200 `{user,session}`                                                                                                               |
| GET /sessions               | Access cookie                  | 200 `{sessions:[...]}` up to 100 active devices                                                                                    |
| DELETE /sessions/:sessionId | Access cookie                  | 200 `{revoked:true}` for an owned session                                                                                          |

The auth limiter defaults to 30 requests per IP and 5 per email/IP pair per 10 minutes. It fails closed with 503 `AUTH_RATE_UNAVAILABLE` if Redis cannot enforce it. Excess requests return 429 `AUTH_RATE_LIMITED` with `Retry-After`. Email and IP keys are HMACs. Missing or mismatched CSRF tokens return 403 `CSRF_INVALID`. Login with an unknown email or wrong password returns the same 401 `INVALID_CREDENTIALS`. Phase 3b reset tokens expire after one hour and new issuance invalidates older reset tokens.

All three routes can return 429 RATE_LIMITED with Retry-After. A disallowed browser Origin returns 403 ORIGIN_NOT_ALLOWED; an invalid production configuration fails the request with a generic 500 without revealing values.

## Planned routes by module

| Module                      | Endpoints under /api/v1                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth 3b (implemented above) | Password recovery, password change, and TOTP 2FA; Google/Microsoft OAuth is a later optional sub-step                                                                                                |
| Organization and people     | GET,POST /organizations; GET,PATCH /organizations/:id; GET,POST /memberships, /departments, /teams, /invitations; PATCH,DELETE /memberships/:id; POST /invitations/accept; GET,PATCH /profile                                                                                                           |
| Projects and planning       | GET,POST /projects, /project-templates; GET,PATCH,DELETE /projects/:id; POST /projects/:id/clone, /projects/:id/archive; GET,PUT /projects/:id/workflow; GET,POST /projects/:id/sprints, /projects/:id/milestones, /projects/:id/goals                                                                  |
| Tasks and collaboration     | GET,POST /projects/:projectId/tasks; GET,PATCH,DELETE /tasks/:id; POST /tasks/:id/move, /tasks/:id/complete, /tasks/:id/restore; GET,POST /tasks/:id/comments, /tasks/:id/dependencies, /tasks/:id/time-entries; GET,POST /saved-filters; GET,POST /projects/:id/docs                                   |
| Attachments                 | POST /attachments/upload-url for an authorized direct upload; POST /attachments/complete; GET /attachments/:id/download-url                                                                                                                                                                             |
| Notifications               | GET /notifications; PATCH /notifications/:id/read; GET,PUT /notification-preferences                                                                                                                                                                                                                    |
| Blockers                    | GET,POST /tasks/:taskId/blockers; GET,PATCH /blockers/:id; POST /blockers/:id/resolve, /blockers/:id/cancel; GET /blockers/waiting-on-me, /blockers/waiting-on-others, /blockers/stalled, /blockers/analytics; GET,PUT /escalation-policies/:id                                                         |
| Request desk and SLA        | GET,POST /request-types, /requests, /sla-policies, /business-calendars; GET,PATCH /request-types/:id, /requests/:id; POST /requests/:id/assign, /requests/:id/convert-to-task, /requests/:id/feedback; GET /approvals/inbox; POST /approvals/:id/decide, /approvals/:id/delegate; GET /requests/reports |
| Forecasting                 | POST /forecasts; GET /forecasts/:runId, /projects/:id/forecast-snapshots; POST /forecasts/scenarios                                                                                                                                                                                                     |
| WhatsApp                    | POST /whatsapp/link/start, /whatsapp/link/verify, /whatsapp/opt-out; GET,PUT /whatsapp/preferences; GET /whatsapp/messages; GET,POST /webhooks/whatsapp                                                                                                                                                 |
| Reporting and exports       | GET /projects/:id/backlog, /projects/:id/workload, /projects/:id/reports; POST /exports; GET /exports/:id; GET /exports/:id/download-url                                                                                                                                                                |
| Automation and integrations | GET,POST /automation-rules, /outgoing-webhooks, /api-keys, /integrations; GET /automation-runs; POST /imports; POST /webhooks/github, /webhooks/gitlab                                                                                                                                                  |
| Administration and billing  | GET /admin/audit-logs, /admin/usage; GET,PUT /admin/branding, /admin/retention; GET /plans, /subscription; POST /subscription/checkout; POST /webhooks/stripe, /webhooks/razorpay; POST /tenant-exports                                                                                                 |

Webhook routes use the provider's signature and an idempotent receipt. Internal /internal/jobs/* and /internal/cron/* routes sit outside the public versioned API, require signatures or CRON_SECRET, and process bounded work. No public endpoint accepts organizationId as authority.

## Phase 3b auth routes

All paths are under `/api/v1/auth`, use shared Zod schemas, and return `Cache-Control: no-store`.

| Route | Request | Success |
| --- | --- | --- |
| POST /forgot-password | `{email}` | 202 `{accepted:true}` immediately; asynchronous email for known accounts |
| POST /reset-password | `{token,newPassword}` | `{reset:true}`; verifies email and revokes all sessions |
| POST /change-password | `{currentPassword,newPassword}` | `{changed:true}`; keeps the current session |
| POST /2fa/setup | `{password}` | `{otpauthUri}`; pending secret bound to session for 10 minutes |
| POST /2fa/setup/confirm | `{code}` | `{enabled:true,recoveryCodes}`; codes shown once |
| POST /2fa/challenge | `{challengeToken,factor,code}` | `{user,session,remainingRecoveryCodes?}` and cookies |
| POST /2fa/disable | `{password,factor,code}` | `{enabled:false}` |
| POST /2fa/recovery-codes/regenerate | `{password,code}` | `{recoveryCodes,remainingCount:10}` |

Correct-password login on a 2FA account returns `{mfaRequired:true,challengeToken}` without a session. The challenge expires in 5 minutes and permits at most 5 atomically reserved attempts. TOTP accepts a 30-second step plus or minus one and rejects replay. Recovery codes are single use. Reset tokens last 1 hour; a new request invalidates earlier tokens. Reset never signs the user in and does not bypass 2FA. Sensitive authenticated routes have an additional fail-closed limit of 5 requests per user and per user/IP in 10 minutes.

## Current foundation behavior

- GET /api/v1/ready checks MongoDB, while GET /api/v1/health is a liveness response and does not depend on MongoDB.
- All /api/v1 routes use a general Upstash limit of 60 requests per minute per client IP. A limit returns 429 RATE_LIMITED with Retry-After. The general limiter **fails open** if Upstash is unavailable, logging the outage without raw IPs; health and readiness remain reachable. Missing credentials fail configuration validation in Production; local development and tests may run without Redis. Future authentication routes need a separate fail-closed limit before launch. CORS preflight is answered before the limiter.
- Requests from configured exact origins receive credentialed CORS headers. `WEB_ORIGIN` is a comma-separated allowlist; wildcard origins are rejected. The liveness endpoint accepts no query parameters and returns VALIDATION_ERROR for unexpected ones.
- Mutations that may be retried accept an idempotency key when implemented. Concurrent edits use version checks. Upload request bodies do not carry file bytes.
