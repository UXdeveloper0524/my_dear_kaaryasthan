import mongoose, { Schema } from 'mongoose';

const base = { timestamps: true, strict: true } as const;
const encrypted = new Schema(
  {
    keyVersion: { type: Number, required: true },
    value: { type: String, required: true },
  },
  { _id: false },
);
const userSchema = new Schema(
  {
    emailLookupHmac: { type: String, required: true },
    emailEncrypted: { type: encrypted, required: true },
    keyVersion: { type: Number, required: true },
    displayName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'disabled'],
      required: true,
    },
    verifiedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  base,
);
userSchema.index(
  { emailLookupHmac: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } },
);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    activeOrganizationId: { type: Schema.Types.ObjectId, default: null },
    familyId: { type: String, required: true },
    currentRefreshTokenId: { type: Schema.Types.ObjectId },
    deviceLabel: { type: String, required: true },
    createdIpHmac: { type: String },
    keyVersion: { type: Number, required: true },
    lastSeenAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  base,
);
sessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });
sessionSchema.index({ familyId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const refreshSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    familyId: { type: String, required: true },
    tokenHmac: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    successorTokenId: { type: Schema.Types.ObjectId, default: null },
    purgeAfter: { type: Date, required: true },
  },
  base,
);
refreshSchema.index({ tokenHmac: 1 }, { unique: true });
refreshSchema.index({ familyId: 1, usedAt: 1 });
refreshSchema.index({ sessionId: 1, issuedAt: -1 });
refreshSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });

const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, required: true },
    tokenPrefix: { type: String, required: true },
    tokenHmac: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  base,
);
authTokenSchema.index({ tokenHmac: 1 }, { unique: true });
authTokenSchema.index({ purpose: 1, tokenPrefix: 1 }, { unique: true });
authTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const auditSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    event: { type: String, required: true },
    outcome: { type: String, required: true },
    requestId: String,
    ipHmac: String,
    keyVersion: { type: Number, required: true },
    occurredAt: { type: Date, required: true },
    purgeAfter: { type: Date, required: true },
  },
  base,
);
auditSchema.index({ userId: 1, occurredAt: -1 });
auditSchema.index({ event: 1, occurredAt: -1 });
auditSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });

type UserDoc = mongoose.InferSchemaType<typeof userSchema>;
type SessionDoc = mongoose.InferSchemaType<typeof sessionSchema>;
type RefreshDoc = mongoose.InferSchemaType<typeof refreshSchema>;
type AuthTokenDoc = mongoose.InferSchemaType<typeof authTokenSchema>;
type AuditDoc = mongoose.InferSchemaType<typeof auditSchema>;
export const User =
  (mongoose.models.AuthUser as mongoose.Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>('AuthUser', userSchema, 'users');
export const Session =
  (mongoose.models.AuthSession as mongoose.Model<SessionDoc> | undefined) ??
  mongoose.model<SessionDoc>('AuthSession', sessionSchema, 'sessions');
export const RefreshToken =
  (mongoose.models.AuthRefreshToken as
    mongoose.Model<RefreshDoc> | undefined) ??
  mongoose.model<RefreshDoc>(
    'AuthRefreshToken',
    refreshSchema,
    'refreshTokens',
  );
export const AuthToken =
  (mongoose.models.AuthToken as mongoose.Model<AuthTokenDoc> | undefined) ??
  mongoose.model<AuthTokenDoc>('AuthToken', authTokenSchema, 'authTokens');
export const AuthAudit =
  (mongoose.models.AuthAudit as mongoose.Model<AuditDoc> | undefined) ??
  mongoose.model<AuditDoc>('AuthAudit', auditSchema, 'authAuditLogs');
