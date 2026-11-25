import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index';

describe('healthResponseSchema', () => {
  it('accepts the API health envelope', () => {
    expect(
      healthResponseSchema.parse({
        data: { status: 'ok', service: 'kaaryasthan-api' },
        meta: null,
        error: null,
      }).data.status,
    ).toBe('ok');
  });
});
