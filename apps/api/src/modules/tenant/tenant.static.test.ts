import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { tenantRoutePermissions, tenantRoutes } from './routes.js';
import { permissionKeys } from '@kaaryasthan/shared';

async function sourceFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? sourceFiles(join(folder, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(folder, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}
describe('tenant boundaries', () => {
  it('keeps the generated permission matrix current', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-permissions.ts', '--check'],
        { cwd: process.cwd(), stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
  it('maps every tenant route to a shared permission or named pre-tenant gate', () => {
    const actual = (
      tenantRoutes as unknown as {
        stack: { route?: { path: string; methods: Record<string, boolean> } }[];
      }
    ).stack.flatMap((layer) =>
      layer.route
        ? Object.keys(layer.route.methods)
            .filter((method) => layer.route!.methods[method])
            .map((method) => `${method.toUpperCase()} ${layer.route!.path}`)
        : [],
    );
    expect(actual.sort()).toEqual(Object.keys(tenantRoutePermissions).sort());
    for (const gate of Object.values(tenantRoutePermissions))
      expect(
        permissionKeys.includes(gate as (typeof permissionKeys)[number]) ||
          ['verified-user', 'active-memberships', 'active-membership'].includes(
            gate,
          ),
      ).toBe(true);
  });
  it('restricts all model access and SystemContext factory imports to explicit boundaries', async () => {
    const root = process.cwd();
    const files = [
      ...(await sourceFiles(join(root, 'src'))),
      ...(await sourceFiles(join(root, 'scripts'))),
    ];
    const allowedModelImports = new Set([
      'src/modules/tenant/repository.ts',
      'src/modules/tenant/system-repository.ts',
      'src/middleware/auth-session.ts',
      'src/modules/auth/controller.ts',
      'src/modules/auth/service.ts',
      'src/modules/auth/phase3b.ts',
      'scripts/migrate-tenant-indexes.ts',
      'scripts/migrate-auth-indexes.ts',
    ]);
    const modelCall =
      /\b(?:User|Session|RefreshToken|AuthToken|AuthAudit|AuthNotification|Organization|Membership|Role|TenantAudit|SystemAudit|SystemReceipt)\.(?:find\w*|update\w*|delete\w*|create\w*|countDocuments|aggregate|bulkWrite|populate|insertMany|init)\s*\(/;
    for (const file of files) {
      const name = relative(root, file).replaceAll('\\', '/');
      if (name.endsWith('.test.ts') || name.endsWith('/models.ts')) continue;
      const code = await readFile(file, 'utf8');
      const importsModels =
        /(?:from\s*|import\s*\()\s*['"][^'"]*models\.js['"]/.test(code);
      if (importsModels || modelCall.test(code) || code.includes('await db()'))
        expect(allowedModelImports.has(name), name).toBe(true);
      if (code.includes('internal/system-context.js'))
        expect(name.startsWith('src/internal/'), name).toBe(true);
    }
  });
});
