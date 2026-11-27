# Event catalog

Implemented Phase 3 global audit event names:

| Flow | Events |
| --- | --- |
| Account and session | `auth.register`, `auth.verify_resend`, `auth.verify_email`, `auth.login`, `auth.refresh`, `auth.refresh_reuse`, `auth.logout`, `auth.session_revoke` |
| Password | `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.password_changed`, `auth.password_change_failed` |
| TOTP and recovery | `auth.mfa_setup_started`, `auth.mfa_setup_failed`, `auth.mfa_enabled`, `auth.mfa_challenge_issued`, `auth.mfa_challenge_failed`, `auth.mfa_challenge_locked`, `auth.mfa_challenge_succeeded`, `auth.mfa_recovery_code_used`, `auth.mfa_recovery_codes_regenerated`, `auth.mfa_regenerate_failed`, `auth.mfa_disabled`, `auth.mfa_disable_failed` |
| Abuse control | `auth.rate_limited` |
| Phase 4a tenant core | `organization.created`, `organization.updated`, `membership.organization_switched`, `role.created`, `role.updated`, `role.deleted` |
| Phase 4a infrastructure guard | `system_context.created`, `system_context.denied` |

Phase 4a tenant audits record organizationId, actorId, event, outcome, subjectId, requestId and occurredAt. The SystemContext guard writes global creation or denial audits; denials are throttled by a five-minute HMAC key, and signed-job nonce HMACs are retained briefly for replay protection. No raw credentials or user-supplied payloads appear in these records.

Audit rows contain outcome, known user ID, request ID, time, and IP HMAC; never email, password, token, TOTP code, recovery code, URI, or message body. Security notification outbox rows store template references without secrets. Immediate send is implemented; retry delivery remains pending a scheduler decision. A reset-link email necessarily contains its one-time token, but that token is not placed in the audit or notification outbox.

Current gap: the forgot-password audit write follows asynchronous token creation and mail delivery. If that background work fails, the HTTP response remains generic 202 and the `auth.password_reset_requested` row may be absent. The background failure path needs an explicit secret-free failure audit and operational alert before production use.

Events are planned domain contracts for notifications, realtime updates, activity, audit, and outgoing webhooks. A durable event has eventId, schemaVersion, organizationId, type, actorId, subjectType, subjectId, occurredAt, and a minimal payload. eventId is the delivery idempotency key. Store the event and business change transactionally where possible, then enqueue delivery. Subscribers never assume ordering across subjects. External delivery retries with backoff and a dead-letter record.

Phase 3 auth writes global `authAuditLogs`, not tenant outbox events. Each record stores outcome, known user ID, request ID, IP HMAC and timestamp. No raw email, IP, token, or message body is included. These records have a one-year TTL. Security notification references use the separate global `authNotificationOutbox`.

| Event type                                                  | Trigger                            | Consumers                                                           |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| member.invited, member.deactivated                          | Invitation or deactivation         | Email, audit                                                        |
| project.created, project.archived                           | Project lifecycle                  | Realtime, activity, webhooks                                        |
| task.created, task.moved, task.completed                    | Task lifecycle                     | Realtime, notifications, activity, webhooks, automation             |
| comment.added, attachment.added                             | Collaboration                      | Notifications, realtime, activity                                   |
| blocker.raised, blocker.escalated, blocker.resolved         | Blocker engine                     | Notifications, stalled view, realtime, audit, webhooks              |
| request.submitted, request.assigned, request.status_changed | Request desk                       | Notifications, realtime, activity, webhooks                         |
| approval.requested, approval.decided, approval.delegated    | Approval flow                      | Assigned approvers, requester, audit, webhooks                      |
| sla.warning, sla.breached                                   | Bounded SLA evaluator              | Notifications, escalation, audit, webhooks                          |
| forecast.requested, forecast.completed, forecast.failed     | Forecast jobs                      | Realtime, requester notification                                    |
| whatsapp.linked, whatsapp.opted_out                         | Phone consent                      | Audit, user notification                                            |
| whatsapp.message.received, whatsapp.delivery.failed         | Verified Meta webhook or send job  | Deduplicated command job, delivery status; no message body in event |
| automation.fired, webhook.delivery_failed                   | Rule and outbound delivery         | Run log, admin alert, audit                                         |
| export.ready, export.failed                                 | Export job                         | Requester notification                                              |
| subscription.changed, usage.limit_reached                   | Signed billing webhook or metering | Entitlements, notification, audit                                   |

Realtime can fail without losing durable state. Notification preferences and consent control channels, while security and audit records remain mandatory. Outgoing webhooks get signed payloads, event IDs, retries, and delivery status. Phone numbers, message bodies, credentials, and payment details stay out of event payloads and logs; consumers fetch authorized details by reference.
