# Permissions

Phase 4a core policy, with later module permissions listed for future implementation. Default organization roles: Owner, Admin, Manager, Team Lead, Member, Guest/Client. The API is authoritative and denies by default. Every check combines an authenticated user, active organization membership, named permission, resource scope, and any explicit share. A role never crosses tenant boundaries. The matrix between the markers is generated from `packages/shared/src/permissions.ts` by `pnpm --filter @kaaryasthan/api permissions:generate` and checked in tests.

Legend: Y = organization-wide within visibility rules; S = managed or assigned scope; O = own record; A = named approver; E = explicit share; — = denied. A cell is the maximum default grant, not an automatic grant for every resource.

<!-- permission-matrix:start -->
| Permission                          | Owner | Admin | Manager | Team Lead | Member | Guest/Client |
| ---                                 | ---   | ---   | ---     | ---       | ---    | ---          |
| organization.view                   | Y     | Y     | Y       | Y         | Y      | Y            |
| organization.manage                 | Y     | —     | —       | —         | —      | —            |
| billing.view                        | Y     | Y     | —       | —         | —      | —            |
| billing.manage                      | Y     | —     | —       | —         | —      | —            |
| members.invite_and_deactivate       | Y     | Y     | S       | —         | —      | —            |
| roles.manage                        | Y     | Y     | —       | —         | —      | —            |
| roles.view                          | Y     | Y     | Y       | Y         | Y      | Y            |
| departments_and_teams.manage        | Y     | Y     | S       | S         | —      | —            |
| projects.create                     | Y     | Y     | S       | —         | —      | —            |
| projects.configure_workflow         | Y     | Y     | S       | S         | —      | —            |
| projects.archive_or_clone           | Y     | Y     | S       | —         | —      | —            |
| projects.admin_override             | Y     | Y     | —       | —         | —      | —            |
| custom_fields.manage                | Y     | Y     | S       | S         | —      | —            |
| templates.manage                    | Y     | Y     | S       | S         | —      | —            |
| shares.manage                       | Y     | Y     | S       | S         | —      | —            |
| tasks.view                          | Y     | Y     | S       | S         | S      | E            |
| tasks.create_and_edit               | Y     | Y     | S       | S         | S      | E            |
| tasks.delete_or_restore             | Y     | Y     | S       | S         | O      | —            |
| comments.post_internal              | Y     | Y     | S       | S         | S      | —            |
| blockers.raise_or_resolve           | Y     | Y     | S       | S         | S      | E            |
| blockers.policy.manage              | Y     | Y     | S       | —         | —      | —            |
| requests.submit_and_view            | Y     | Y     | S       | S         | O      | E            |
| requests.handle                     | S     | S     | S       | S         | —      | —            |
| requests.assign_and_route           | Y     | Y     | S       | S         | —      | —            |
| request_types.manage                | Y     | Y     | S       | —         | —      | —            |
| approvals.decide_or_delegate        | A     | A     | A       | A         | A      | —            |
| sla_policies.manage                 | Y     | Y     | S       | —         | —      | —            |
| calendars.manage                    | Y     | Y     | S       | —         | —      | —            |
| forecasts.view                      | Y     | Y     | S       | S         | S      | —            |
| reports.view                        | Y     | Y     | S       | S         | S      | —            |
| costs.view                          | Y     | Y     | S       | —         | —      | —            |
| time.log                            | Y     | Y     | S       | S         | O      | —            |
| time.view                           | Y     | Y     | S       | S         | O      | —            |
| time.approve                        | Y     | Y     | S       | S         | —      | —            |
| time.manage                         | Y     | Y     | S       | —         | —      | —            |
| data.export                         | Y     | Y     | S       | S         | —      | —            |
| data.retention                      | Y     | Y     | —       | —         | —      | —            |
| automations_and_integrations.manage | Y     | Y     | S       | —         | —      | —            |
| whatsapp.self_manage                | O     | O     | O       | O         | O      | —            |
| whatsapp.configure_org              | Y     | Y     | —       | —         | —      | —            |
| audit_logs.view                     | Y     | Y     | —       | —         | —      | —            |
| api_keys.manage                     | Y     | Y     | —       | —         | —      | —            |
<!-- permission-matrix:end -->

The time.* namespace covers logging, viewing, approval, and rate-sensitive management. costs.view gates rateCards, cost rates, and cost reports independently of time.view. data.export requires a second filter that restricts columns and rows to the caller's scope; it never turns a scoped report into a tenant-wide export.

## Resolving S and visibility

The grant partial order is `Y ⊇ S ⊇ O`. A grantor with Y may grant Y, S, or O; S may grant S or O; O may grant only O. A and E are separate predicates: each is grantable only by a grantor holding the same code. All other pairs are denied. Rank and this scope order are checked separately; rank never widens a permission. The shared `canGrantScope` function and an exhaustive pairwise test enforce this rule.

S is computed server-side from active memberships, managed department/team IDs, `projectMembers` per-project role and status, `requestQueues` handler membership, and assignment. It is **not** inferred from a client-supplied ID or a title such as “Manager.” `requests.handle` is queue-scoped even for Owner and Admin: a handler must belong to the request's assigned queue or be explicitly assigned, then have the permission. A user with `requests.assign_and_route` may assign themselves through an audited action. `approvals.decide_or_delegate` applies only to the exact approval record and current delegate. `shares.manage` can only create shares within the grantor's visibility and action ceiling; `comments.post_internal` requires membership or scoped access to the parent and never applies to public/guest actors.

Visibility controls discovery, while permissions control actions. Organization-visible projects may be discoverable to members, team-visible projects only to that team, and private projects only to active `projectMembers` or shares. S grants cannot bypass a private project's membership rule. Y grants organization-wide actions on visible resources; access to a private project outside membership requires `projects.admin_override`, a required reason, immutable audit record, and notification to active project members. The override is limited to the stated project and operation, and never silently persists as membership. An E share identifies one subject, action set, principal, and expiry; it never confers a wider role. Public request forms permit submission only, with spam controls and no tenant listing. Polymorphic comments marked internal remain hidden from guest and public readers even if the parent subject is shared.

## Escalation and delegation safeguards

- A grantor may assign only permissions and resource scopes they themselves can grant, never a higher role or a broader scope. No self-promotion, no change of one's own scope through delegation, and no Owner assignment by an Admin or lower role. Custom role definitions have an immutable creator/authority ceiling; later editors cannot raise it beyond their own grantable set.
- An organization must retain at least one active Owner. Deactivation, removal, or downgrade of the last Owner is rejected. Ownership transfer requires an authenticated current Owner, an eligible accepting member, reauthentication or step-up verification, and an audit event before the former Owner can be removed.
- API keys inherit the creator's effective permissions and scope ceiling, carry explicit narrower scopes and expiry, and are rechecked against current membership and role on use. A key cannot create a more powerful key or custom role, and revocation or creator deactivation ends its authority. Pre-tenant token resolution never grants permissions.
- Service actions that change roles, billing, retention, costs, shares, API keys, or org WhatsApp settings require server-side authorization and an immutable audit record. Every route needs forbidden and cross-tenant tests.

SystemContext is **not a user role**. Only verified cron or signed job infrastructure can create it with a purpose, allowed collection, batch cap, and systemRunId. Its cross-tenant scan returns candidate tenant IDs only; each mutation then runs through a tenant repository and is audited. Public handlers and custom roles cannot obtain SystemContext.

The matrix is generated from shared permission constants, and the static test checks that the file is current. Phase 4a implements organization and role authorization. Project, queue, share, and task scope resolvers start in their later feature phases; the current S resolver denies unless an explicit server-side resolver is supplied.
