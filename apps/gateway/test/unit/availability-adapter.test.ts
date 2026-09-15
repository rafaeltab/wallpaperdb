import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { createAvailabilityProbe } from '../../src/adapters/availability/index.js';

describe('dependency health adapter', () => {
  it('translates technical health failures without rejecting the application read', async () => {
    const probe = createAvailabilityProbe({
      opensearch: async () => true,
      nats: async () => {
        throw new Error('broker unavailable');
      },
      otel: async () => false,
    });
    expect(await Effect.runPromise(probe.inspect())).toEqual({
      opensearch: true,
      nats: false,
      otel: false,
    });
  });
});
