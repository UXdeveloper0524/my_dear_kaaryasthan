import mongoose, { Schema } from 'mongoose';
import { roleKeys } from '@kaaryasthan/shared';

const base = { timestamps: true, strict: true } as const;
const organizationSchema = new Schema(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    settings: {
      timezone: { type: String, default: 'Asia/Kolkata' },
      locale: { type: String, default: 'en-IN' },
    },
    branding: {
      logoUrl: { type: String, default: null },
      primaryColor: { type: String, default: null },
    },
    deletedAt: { type: Date, default: null },
  },
  base,
);
organizationSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } },
);
organizationSchema.index({ ownerId: 1, deletedAt: 1 });

const membershipSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    roleId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['active', 'deactivated'], required: true },
    joinedAt: { type: Date, required: true },
    scopeGrants: { type: Schema.Types.Mixed, default: {} },
  },
  base,
);
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, roleId: 1, status: 1 });
membershipSchema.index({ userId: 1, status: 1, organizationId: 1 });

const roleSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    nameCanonical: { type: String, required: true },
    builtInKey: { type: String, enum: roleKeys, default: null },
    rank: { type: Number, required: true },
    grants: { type: Schema.Types.Mixed, default: undefined },
    creatorId: { type: Schema.Types.ObjectId, default: null },
    creatorCeiling: { type: Schema.Types.Mixed, default: undefined },
    creatorRankCeiling: { type: Number, default: null },
    deletedAt: { type: Date, default: null },
  },
  base,
);
roleSchema.index(
  { organizationId: 1, nameCanonical: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } },
);
roleSchema.index({ organizationId: 1, rank: 1, deletedAt: 1 });

const auditSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    event: { type: String, required: true },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    outcome: { type: String, required: true },
    requestId: { type: String },
    occurredAt: { type: Date, required: true },
  },
  base,
);
auditSchema.index({ organizationId: 1, occurredAt: -1 });
auditSchema.index({ organizationId: 1, subjectId: 1, occurredAt: -1 });

const systemAuditSchema = new Schema(
  {
    systemRunId: { type: String },
    purpose: { type: String },
    targetCollection: { type: String },
    principalType: { type: String, required: true },
    event: { type: String, required: true },
    outcome: { type: String, required: true },
    reasonCode: { type: String },
    requestId: { type: String },
    occurredAt: { type: Date, required: true },
    throttleKey: { type: String, default: null },
  },
  base,
);
systemAuditSchema.index({ systemRunId: 1, occurredAt: -1 });
systemAuditSchema.index({ occurredAt: -1 });
systemAuditSchema.index(
  { throttleKey: 1 },
  {
    unique: true,
    partialFilterExpression: { throttleKey: { $type: 'string' } },
  },
);

const systemReceiptSchema = new Schema(
  {
    nonceHmac: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  base,
);
systemReceiptSchema.index({ nonceHmac: 1 }, { unique: true });
systemReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type OrganizationDoc = mongoose.InferSchemaType<typeof organizationSchema>;
type MembershipDoc = mongoose.InferSchemaType<typeof membershipSchema>;
type RoleDoc = mongoose.InferSchemaType<typeof roleSchema>;
type TenantAuditDoc = mongoose.InferSchemaType<typeof auditSchema>;
type SystemAuditDoc = mongoose.InferSchemaType<typeof systemAuditSchema>;
type SystemReceiptDoc = mongoose.InferSchemaType<typeof systemReceiptSchema>;
export const Organization =
  (mongoose.models.Organization as
    mongoose.Model<OrganizationDoc> | undefined) ??
  mongoose.model<OrganizationDoc>(
    'Organization',
    organizationSchema,
    'organizations',
  );
export const Membership =
  (mongoose.models.Membership as mongoose.Model<MembershipDoc> | undefined) ??
  mongoose.model<MembershipDoc>('Membership', membershipSchema, 'memberships');
export const Role =
  (mongoose.models.Role as mongoose.Model<RoleDoc> | undefined) ??
  mongoose.model<RoleDoc>('Role', roleSchema, 'roles');
export const TenantAudit =
  (mongoose.models.TenantAudit as mongoose.Model<TenantAuditDoc> | undefined) ??
  mongoose.model<TenantAuditDoc>('TenantAudit', auditSchema, 'auditLogs');
export const SystemAudit =
  (mongoose.models.SystemAudit as mongoose.Model<SystemAuditDoc> | undefined) ??
  mongoose.model<SystemAuditDoc>(
    'SystemAudit',
    systemAuditSchema,
    'systemAuditLogs',
  );
export const SystemReceipt =
  (mongoose.models.SystemReceipt as
    mongoose.Model<SystemReceiptDoc> | undefined) ??
  mongoose.model<SystemReceiptDoc>(
    'SystemReceipt',
    systemReceiptSchema,
    'systemReceipts',
  );
