import { connectToDatabase } from '../../lib/db.js';
import { SystemAudit, SystemReceipt } from './models.js';

export async function recordSystemContext(input: {
  principalType: string;
  event: string;
  outcome: string;
  purpose?: string;
  collection?: string;
  systemRunId?: string;
  reasonCode?: string;
  throttleKey?: string;
}) {
  await connectToDatabase();
  try {
    const { collection, ...record } = input;
    await SystemAudit.create({
      ...record,
      targetCollection: collection,
      occurredAt: new Date(),
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000 || !input.throttleKey)
      throw error;
  }
}
export async function consumeJobNonce(nonceHmac: string) {
  await connectToDatabase();
  try {
    await SystemReceipt.create({
      nonceHmac,
      expiresAt: new Date(Date.now() + 600_000),
    });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return false;
  }
}
