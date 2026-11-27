import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from '../config/env.js';
import { ForbiddenError } from '../errors/app-error.js';
import {
  consumeJobNonce,
  recordSystemContext,
} from '../modules/tenant/system-repository.js';

export const systemPurposes = [
  'maintenance',
  'migration',
  'scheduled-recovery',
] as const;
export const systemCollections = [
  'organizations',
  'memberships',
  'roles',
  'auditLogs',
] as const;
export type SystemPurpose = (typeof systemPurposes)[number];
export type SystemCollection = (typeof systemCollections)[number];
export type SystemContext = Readonly<{
  purpose: SystemPurpose;
  collection: SystemCollection;
  runId: string;
}>;

function equal(left: string, right: string) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}
async function denied(
  principalType: string,
  reasonCode: string,
  throttleSeed: string,
) {
  const window = Math.floor(Date.now() / 300_000);
  const throttleKey = createHmac(
    'sha256',
    readEnv().KEY_MASTER_V1 ?? 'unconfigured',
  )
    .update(`${throttleSeed}:${window}`)
    .digest('hex');
  await recordSystemContext({
    principalType,
    event: 'system_context.denied',
    outcome: 'denied',
    reasonCode,
    throttleKey,
  });
}
function allowed(
  purpose: string,
  collection: string,
): purpose is SystemPurpose {
  return (
    (systemPurposes as readonly string[]).includes(purpose) &&
    (systemCollections as readonly string[]).includes(collection)
  );
}

export async function fromScheduler(input: {
  secret: string;
  purpose: string;
  collection: string;
  runId: string;
}): Promise<SystemContext> {
  const expected = readEnv().CRON_SECRET;
  if (
    !expected ||
    !equal(input.secret, expected) ||
    !allowed(input.purpose, input.collection)
  ) {
    await denied('scheduler', 'INVALID_SCHEDULER_CONTEXT', input.runId);
    throw new ForbiddenError();
  }
  await recordSystemContext({
    principalType: 'scheduler',
    event: 'system_context.created',
    outcome: 'success',
    purpose: input.purpose,
    collection: input.collection,
    systemRunId: input.runId,
  });
  return Object.freeze({
    purpose: input.purpose,
    collection: input.collection as SystemCollection,
    runId: input.runId,
  });
}

export async function fromSignedJob(input: {
  signature: string;
  timestamp: number;
  nonce: string;
  purpose: string;
  collection: string;
  runId: string;
}): Promise<SystemContext> {
  const key = readEnv().JOB_SIGNING_SECRET;
  const age = Math.abs(Date.now() - input.timestamp);
  const payload = `${input.timestamp}\n${input.nonce}\n${input.purpose}\n${input.collection}\n${input.runId}`;
  const expected = key
    ? createHmac('sha256', key).update(payload).digest('hex')
    : '';
  if (
    !key ||
    !Number.isSafeInteger(input.timestamp) ||
    age > 300_000 ||
    !/^[a-f0-9]{32,128}$/i.test(input.nonce) ||
    !equal(input.signature, expected) ||
    !allowed(input.purpose, input.collection)
  ) {
    await denied('signed-job', 'INVALID_JOB_CONTEXT', input.runId);
    throw new ForbiddenError();
  }
  const nonceHmac = createHmac('sha256', key).update(input.nonce).digest('hex');
  if (!(await consumeJobNonce(nonceHmac))) {
    await denied('signed-job', 'JOB_REPLAY', input.runId);
    throw new ForbiddenError();
  }
  await recordSystemContext({
    principalType: 'signed-job',
    event: 'system_context.created',
    outcome: 'success',
    purpose: input.purpose,
    collection: input.collection,
    systemRunId: input.runId,
  });
  return Object.freeze({
    purpose: input.purpose,
    collection: input.collection as SystemCollection,
    runId: input.runId,
  });
}
