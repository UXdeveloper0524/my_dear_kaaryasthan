import mongoose from 'mongoose';
import { connectToDatabase } from '../src/lib/db.js';
import {
  AuthAudit,
  AuthToken,
  RefreshToken,
  Session,
  User,
} from '../src/modules/auth/models.js';

async function main() {
  if (!process.argv.includes('--apply'))
    throw new Error(
      'Pass --apply to run the Atlas development index migration',
    );
  await connectToDatabase();
  const duplicate = await User.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$emailLookupHmac', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  if (duplicate.length)
    throw new Error(
      'Active duplicate email lookup values require manual review',
    );
  await User.updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } },
  );
  for (const model of [User, Session, RefreshToken, AuthToken, AuthAudit]) {
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    process.stdout.write(
      `${model.collection.collectionName}: ${indexes.map((index) => index.name).join(', ')}\n`,
    );
  }
  const indexes = await User.collection.indexes();
  const activeEmailIndex = indexes.find(
    (index) =>
      index.unique &&
      index.key?.emailLookupHmac === 1 &&
      JSON.stringify(index.partialFilterExpression) ===
        JSON.stringify({ deletedAt: { $type: 'null' } }),
  );
  if (!activeEmailIndex)
    throw new Error(
      'Active-email unique partial index did not match the migration contract',
    );
  const plan = await User.find({
    emailLookupHmac: 'migration-probe',
    deletedAt: { $type: 'null' },
  }).explain('executionStats');
  const stages = JSON.stringify(
    (plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner
      ?.winningPlan,
  );
  if (!stages.includes('IXSCAN'))
    throw new Error('Active-email query did not use an index');
  process.stdout.write(
    `Active-email query examined ${(plan as { executionStats?: { totalDocsExamined?: number } }).executionStats?.totalDocsExamined ?? 'unknown'} documents\n`,
  );
}
main()
  .catch((error: unknown) => {
    process.stderr.write(
      String(error instanceof Error ? error.message : error),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
