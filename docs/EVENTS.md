# Event catalog

Phase 3b global security events: `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.password_changed`, `auth.password_change_failed`, `auth.mfa_setup_started`, `auth.mfa_setup_failed`, `auth.mfa_enabled`, `auth.mfa_challenge_issued`, `auth.mfa_challenge_failed`, `auth.mfa_challenge_locked`, `auth.mfa_challenge_succeeded`, `auth.mfa_recovery_code_used`, `auth.mfa_recovery_codes_regenerated`, `auth.mfa_regenerate_failed`, `auth.mfa_disabled`, and `auth.mfa_disable_failed`. Audit records contain outcome, known user ID, request ID and IP HMAC; never email, password, token, code, URI or message body.

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
