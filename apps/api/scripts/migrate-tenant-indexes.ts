import mongoose from 'mongoose';
import { connectToDatabase } from '../src/lib/db.js';
import {
  Membership,
  Organization,
  Role,
  TenantAudit,
  SystemAudit,
  SystemReceipt,
} from '../src/modules/tenant/models.js';
import { User } from '../src/modules/auth/models.js';

async function main() {
  if (!process.argv.includes('--apply'))
    throw new Error(
      'Pass --apply to run the Atlas development index migration',
    );
  await connectToDatabase();
  await User.updateMany(
    { organizationsCreatedCount: { $exists: false } },
    { $set: { organizationsCreatedCount: 0 } },
  );
  for (const model of [
    Organization,
    Membership,
    Role,
    TenantAudit,
    SystemAudit,
    SystemReceipt,
  ]) {
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    process.stdout.write(
      `${model.collection.collectionName}: ${indexes.map((index) => index.name).join(', ')}\n`,
    );
  }
  for (const [model, key, filter] of [
    [
      Organization,
      { slug: 1 },
      { slug: 'migration-probe', deletedAt: { $type: 'null' } },
    ],
    [
      Role,
      { organizationId: 1, nameCanonical: 1 },
      {
        organizationId: new mongoose.Types.ObjectId(),
        nameCanonical: 'migration-probe',
        deletedAt: { $type: 'null' },
      },
    ],
  ] as const) {
    const indexes = await model.collection.indexes();
    const partial = indexes.find(
      (index) =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify(key) &&
        JSON.stringify(index.partialFilterExpression) ===
          JSON.stringify({ deletedAt: { $type: 'null' } }),
    );
    if (!partial)
      throw new Error(`${model.modelName} active unique index missing`);
    const query = model.collection
      .find(filter)
      .hint(partial.name! as string)
      .limit(1);
    const plan = await query.explain('executionStats');
    if (!JSON.stringify(plan.queryPlanner.winningPlan).includes('IXSCAN'))
      throw new Error(`${model.modelName} active index was not used`);
    process.stdout.write(
      `${model.modelName} partial-index plan: ${JSON.stringify(plan.queryPlanner.winningPlan)}\n`,
    );
  }
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
