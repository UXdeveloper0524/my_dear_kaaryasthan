import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../app.js';
import { useInMemoryDatabase } from '../test/mongo.js';
import { SystemAudit, SystemReceipt } from '../modules/tenant/models.js';
import { fromScheduler, fromSignedJob } from './system-context.js';
import { connectToDatabase } from '../lib/db.js';

useInMemoryDatabase();
const cron = 'C'.repeat(48);
const job = 'J'.repeat(48);
afterEach(async () => {
  delete process.env.CRON_SECRET;
  delete process.env.JOB_SIGNING_SECRET;
  await SystemAudit.deleteMany({});
  await SystemReceipt.deleteMany({});
});
describe('SystemContext guard', () => {
  it('permits only allowlisted scheduler work and throttles denial audits', async () => {
    process.env.CRON_SECRET = cron;
    await connectToDatabase();
    await SystemAudit.init();
    const input = {
      secret: cron,
      purpose: 'maintenance',
      collection: 'roles',
      runId: 'run-a',
    };
    await expect(fromScheduler(input)).resolves.toMatchObject({
      purpose: 'maintenance',
      collection: 'roles',
    });
    expect(
      await SystemAudit.findOne({ event: 'system_context.created' }).lean(),
    ).toMatchObject({ targetCollection: 'roles' });
    await expect(
      fromScheduler({ ...input, secret: 'bad' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fromScheduler({ ...input, secret: 'bad' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fromScheduler({ ...input, collection: 'users' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fromScheduler({ ...input, purpose: 'user-request' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await SystemAudit.countDocuments({ event: 'system_context.denied' }),
    ).toBe(1);
  });
  it('does not create SystemContext from a request principal', async () => {
    process.env.CRON_SECRET = cron;
    await connectToDatabase();
    await expect(
      fromScheduler({
        secret: 'request-principal',
        purpose: 'maintenance',
        collection: 'roles',
        runId: 'request-attempt',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const response = await request(app)
      .post('/api/v1/internal/system-context')
      .set('Authorization', 'Bearer request-principal')
      .send({ purpose: 'maintenance', collection: 'roles' });
    expect(response.status).toBe(404);
    expect(
      await SystemAudit.countDocuments({ event: 'system_context.created' }),
    ).toBe(0);
  });
  it('checks signed-job timestamp and rejects nonce replay', async () => {
    process.env.JOB_SIGNING_SECRET = job;
    const input = {
      timestamp: Date.now(),
      nonce: 'a'.repeat(32),
      purpose: 'maintenance',
      collection: 'memberships',
      runId: 'run-b',
    };
    const signature = createHmac('sha256', job)
      .update(
        `${input.timestamp}\n${input.nonce}\n${input.purpose}\n${input.collection}\n${input.runId}`,
      )
      .digest('hex');
    await expect(fromSignedJob({ ...input, signature })).resolves.toMatchObject(
      { collection: 'memberships' },
    );
    await expect(fromSignedJob({ ...input, signature })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      fromSignedJob({ ...input, timestamp: Date.now() - 3600_000, signature }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await SystemReceipt.countDocuments()).toBe(1);
  });
});
