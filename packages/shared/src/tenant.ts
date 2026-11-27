import { z } from 'zod';
import { permissionKeys, scopes } from './permissions.js';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const reservedSlugs = new Set([
  'admin',
  'api',
  'auth',
  'billing',
  'help',
  'internal',
  'login',
  'new',
  'root',
  'settings',
  'support',
  'system',
  'www',
]);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((slug) => !reservedSlugs.has(slug), 'Reserved slug');
export const organizationSettingsSchema = z.strictObject({
  timezone: z.string().min(3).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
});
export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  settings: organizationSettingsSchema.optional(),
});
export const updateOrganizationSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    settings: organizationSettingsSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.settings !== undefined);
export const switchOrganizationSchema = z.strictObject({
  organizationId: objectIdSchema,
});
export const roleIdSchema = z.strictObject({ roleId: objectIdSchema });
export const grantsSchema = z.partialRecord(
  z.enum(
    permissionKeys as [
      (typeof permissionKeys)[number],
      ...(typeof permissionKeys)[number][],
    ],
  ),
  z.enum(scopes),
);
export const createRoleSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  rank: z.number().int().min(1).max(599),
  grants: grantsSchema,
});
export const updateRoleSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80).optional(),
    rank: z.number().int().min(1).max(599).optional(),
    grants: grantsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const cursorQuerySchema = z.strictObject({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const organizationSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  branding: z.object({
    logoUrl: z.string().nullable(),
    primaryColor: z.string().nullable(),
  }),
  settings: organizationSettingsSchema.optional(),
});
export const roleSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  rank: z.number(),
  builtInKey: z.string().nullable(),
  grants: grantsSchema,
});
export const createOrganizationResponseSchema = z.object({
  data: z.object({
    organization: organizationSchema,
    membership: z.object({ role: z.literal('Owner') }),
  }),
  meta: z.null(),
  error: z.null(),
});
export const currentOrganizationResponseSchema = z.object({
  data: z.object({
    organization: organizationSchema,
    membership: z.object({ roleId: objectIdSchema }),
    role: roleSchema,
  }),
  meta: z.null(),
  error: z.null(),
});
export const updateOrganizationResponseSchema = z.object({
  data: z.object({ organization: organizationSchema }),
  meta: z.null(),
  error: z.null(),
});
export const organizationListResponseSchema = z.object({
  data: z.object({
    items: z.array(organizationSchema),
    nextCursor: objectIdSchema.nullable(),
  }),
  meta: z.null(),
  error: z.null(),
});
export const switchOrganizationResponseSchema = z.object({
  data: z.object({
    activeOrganizationId: objectIdSchema,
    organization: organizationSchema,
  }),
  meta: z.null(),
  error: z.null(),
});
export const roleResponseSchema = z.object({
  data: z.object({ role: roleSchema }),
  meta: z.null(),
  error: z.null(),
});
export const roleListResponseSchema = z.object({
  data: z.object({
    items: z.array(roleSchema),
    nextCursor: objectIdSchema.nullable(),
  }),
  meta: z.null(),
  error: z.null(),
});
export const deletedRoleResponseSchema = z.object({
  data: z.object({ deleted: z.literal(true) }),
  meta: z.null(),
  error: z.null(),
});
