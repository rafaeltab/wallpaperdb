import { Effect } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryQuota, createRedisQuota } from '../src/adapters/redis/index.js';

let container: StartedTestContainer;
beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
});
afterAll(async () => {
  await container?.stop();
});
function distributed() {
  return createRedisQuota({
    redisEnabled: true,
    redisHost: '127.0.0.1',
    redisPort: container.getMappedPort(6379),
  });
}
describe('quota storage contract', () => {
  it('atomically shares windows across two live Redis adapters and keeps keys isolated', async () => {
    const a = distributed();
    const b = distributed();
    await a.start();
    await b.start();
    try {
      const results = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).take('shared', 3, 60000)),
          { concurrency: 'unbounded' }
        )
      );
      expect(results.filter((r) => r._tag === 'Allowed')).toHaveLength(3);
      expect(results.filter((r) => r._tag === 'Limited')).toHaveLength(5);
      expect(await Effect.runPromise(b.take('other', 3, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 2,
      });
    } finally {
      await a.stop();
      await b.stop();
    }
  });
  it('uses instance-local windows with identical quota semantics when Redis is disabled or unreachable', async () => {
    for (const redisEnabled of [false, true]) {
      const adapter = createRedisQuota({ redisEnabled, redisHost: '127.0.0.1', redisPort: 1 });
      await adapter.start();
      expect(await Effect.runPromise(adapter.take('fallback', 1, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      expect(await Effect.runPromise(adapter.take('fallback', 1, 60000))).toMatchObject({
        _tag: 'Limited',
      });
      await adapter.stop();
    }
  });
  it('memory and Redis both leave denied windows unchanged', async () => {
    const redis = distributed();
    await redis.start();
    try {
      for (const adapter of [createMemoryQuota(), redis]) {
        const first = await Effect.runPromise(adapter.take('window', 1, 60000));
        const denied = await Effect.runPromise(adapter.take('window', 1, 60000));
        expect(first._tag).toBe('Allowed');
        expect(denied._tag).toBe('Limited');
        if (denied._tag === 'Limited') expect(denied.retryAfter).toBeLessThanOrEqual(60000);
      }
    } finally {
      await redis.stop();
    }
  });
});
