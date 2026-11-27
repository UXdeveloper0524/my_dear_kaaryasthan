export const roleKeys = [
  'Owner',
  'Admin',
  'Manager',
  'Team Lead',
  'Member',
  'Guest/Client',
] as const;
export type BuiltInRoleKey = (typeof roleKeys)[number];
export const roleRanks: Record<BuiltInRoleKey, number> = {
  Owner: 600,
  Admin: 500,
  Manager: 400,
  'Team Lead': 300,
  Member: 200,
  'Guest/Client': 100,
};
export const scopes = ['Y', 'S', 'O', 'A', 'E'] as const;
export type Scope = (typeof scopes)[number];
type Cell = Scope | '—';
// This table is the source for docs/PERMISSIONS.md and built-in role grants.
export const permissionMatrix = {
  'organization.view': ['Y', 'Y', 'Y', 'Y', 'Y', 'Y'],
  'organization.manage': ['Y', '—', '—', '—', '—', '—'],
  'billing.view': ['Y', 'Y', '—', '—', '—', '—'],
  'billing.manage': ['Y', '—', '—', '—', '—', '—'],
  'members.invite_and_deactivate': ['Y', 'Y', 'S', '—', '—', '—'],
  'roles.manage': ['Y', 'Y', '—', '—', '—', '—'],
  'roles.view': ['Y', 'Y', 'Y', 'Y', 'Y', 'Y'],
  'departments_and_teams.manage': ['Y', 'Y', 'S', 'S', '—', '—'],
  'projects.create': ['Y', 'Y', 'S', '—', '—', '—'],
  'projects.configure_workflow': ['Y', 'Y', 'S', 'S', '—', '—'],
  'projects.archive_or_clone': ['Y', 'Y', 'S', '—', '—', '—'],
  'projects.admin_override': ['Y', 'Y', '—', '—', '—', '—'],
  'custom_fields.manage': ['Y', 'Y', 'S', 'S', '—', '—'],
  'templates.manage': ['Y', 'Y', 'S', 'S', '—', '—'],
  'shares.manage': ['Y', 'Y', 'S', 'S', '—', '—'],
  'tasks.view': ['Y', 'Y', 'S', 'S', 'S', 'E'],
  'tasks.create_and_edit': ['Y', 'Y', 'S', 'S', 'S', 'E'],
  'tasks.delete_or_restore': ['Y', 'Y', 'S', 'S', 'O', '—'],
  'comments.post_internal': ['Y', 'Y', 'S', 'S', 'S', '—'],
  'blockers.raise_or_resolve': ['Y', 'Y', 'S', 'S', 'S', 'E'],
  'blockers.policy.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'requests.submit_and_view': ['Y', 'Y', 'S', 'S', 'O', 'E'],
  'requests.handle': ['S', 'S', 'S', 'S', '—', '—'],
  'requests.assign_and_route': ['Y', 'Y', 'S', 'S', '—', '—'],
  'request_types.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'approvals.decide_or_delegate': ['A', 'A', 'A', 'A', 'A', '—'],
  'sla_policies.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'calendars.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'forecasts.view': ['Y', 'Y', 'S', 'S', 'S', '—'],
  'reports.view': ['Y', 'Y', 'S', 'S', 'S', '—'],
  'costs.view': ['Y', 'Y', 'S', '—', '—', '—'],
  'time.log': ['Y', 'Y', 'S', 'S', 'O', '—'],
  'time.view': ['Y', 'Y', 'S', 'S', 'O', '—'],
  'time.approve': ['Y', 'Y', 'S', 'S', '—', '—'],
  'time.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'data.export': ['Y', 'Y', 'S', 'S', '—', '—'],
  'data.retention': ['Y', 'Y', '—', '—', '—', '—'],
  'automations_and_integrations.manage': ['Y', 'Y', 'S', '—', '—', '—'],
  'whatsapp.self_manage': ['O', 'O', 'O', 'O', 'O', '—'],
  'whatsapp.configure_org': ['Y', 'Y', '—', '—', '—', '—'],
  'audit_logs.view': ['Y', 'Y', '—', '—', '—', '—'],
  'api_keys.manage': ['Y', 'Y', '—', '—', '—', '—'],
} as const satisfies Record<
  string,
  readonly [Cell, Cell, Cell, Cell, Cell, Cell]
>;
export type PermissionKey = keyof typeof permissionMatrix;
export const permissionKeys = Object.keys(permissionMatrix) as PermissionKey[];
export function builtInGrants(
  role: BuiltInRoleKey,
): Partial<Record<PermissionKey, Scope>> {
  const index = roleKeys.indexOf(role);
  return Object.fromEntries(
    permissionKeys.flatMap((key) => {
      const scope = permissionMatrix[key][index];
      return scope === '—' ? [] : [[key, scope]];
    }),
  ) as Partial<Record<PermissionKey, Scope>>;
}
export function canGrantScope(grantor: Scope, requested: Scope): boolean {
  if (grantor === requested) return true;
  return (
    (grantor === 'Y' && (requested === 'S' || requested === 'O')) ||
    (grantor === 'S' && requested === 'O')
  );
}
