import type { RedisClientType } from 'redis';
import { expect, it, vi } from 'vitest';
import { createGroup, timing } from './fixture';

const routing = vi.hoisted(() => ({
  cleaner: undefined as ((client: unknown) => void) | undefined,
}));

vi.mock('redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('redis')>();
  return {
    ...actual,
    createClient: ((...args: Parameters<typeof actual.createClient>) => {
      const client = actual.createClient(...args);
      if (args[0]?.name?.endsWith(':cleanup')) routing.cleaner?.(client);
      return client;
    }) as typeof actual.createClient,
  };
});

it.each([
  'disconnected',
  'detached write',
] as const)('removes exact owned keys from a %s client before its case settles', async (mode) => {
  const group = await createGroup();
  let detached: Promise<unknown> | undefined;
  try {
    await group.runCase('survivor', async (peer) => {
      const peerKey = peer.key('owned');
      const channel = peer.channel('owned');
      const messages: string[] = [];
      await peer.client.set(peerKey, 'survives');
      await peer.subscribe(channel, (message) => messages.push(message));
      let retiredKey = '';
      try {
        await group.runCase('retired', async (scope) => {
          retiredKey = scope.key('owned');
          await scope.client.set(retiredKey, 'initial');
          if (mode === 'disconnected') {
            await scope.client.disconnect();
          } else {
            // node-redis corks DEL until setImmediate; a retained raw client can
            // otherwise insert SET behind DEL and before cleanup queues QUIT.
            detached = new Promise<void>((resolve, reject) => {
              setImmediate(() =>
                scope.client.set(retiredKey, 'late').then(() => resolve(), reject)
              );
            }).catch((error: unknown) => error);
          }
        });
        await detached;
        expect(await peer.client.get(retiredKey)).toBeNull();
        expect(await peer.client.get(peerKey)).toBe('survives');
        expect(await peer.client.dbSize()).toBe(1);
        await peer.client.publish(channel, 'still active');
        await expect.poll(() => messages).toEqual(['still active']);
      } finally {
        // Also clean up the old implementation's leaked key after a red assertion.
        await peer.client.del(retiredKey);
      }
    });
  } finally {
    await detached;
    await group.close();
  }
}, 15000);

it('bounds the private cleanup DEL and preserves the original case failure', async () => {
  const metrics = timing();
  const group = await createGroup(metrics, 100);
  let cleaner: RedisClientType | undefined;
  let restore: (() => void) | undefined;
  let delEntered = false;
  let settled = false;
  const bodyError = new Error('intentional body failure');
  routing.cleaner = (captured) => {
    const control = captured as RedisClientType;
    cleaner = control;
    const del = control.del.bind(control);
    const spy = vi.spyOn(control, 'del').mockImplementation(async (...args) => {
      await control.clientPause(5000, 'ALL');
      delEntered = true;
      return del(...args);
    });
    restore = () => spy.mockRestore();
  };
  const result = group
    .runCase('stalled-deletion', async (scope) => {
      await scope.client.set(scope.key('owned'), 'value');
      throw bodyError;
    })
    .catch((error: unknown) => {
      settled = true;
      return error;
    });
  try {
    await expect.poll(() => settled, { timeout: 1500 }).toBe(true);
    expect(delEntered).toBe(true);
    const error = await result;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toContain(bodyError);
    expect((error as AggregateError).errors.map(String).join(' ')).toContain('Redis DEL timed out');
    expect(cleaner?.isOpen).toBe(false);
  } finally {
    routing.cleaner = undefined;
    await result;
    await group.close().catch(() => {});
    restore?.();
  }
  expect(metrics.containersRemoved).toBe(1);
}, 15000);
