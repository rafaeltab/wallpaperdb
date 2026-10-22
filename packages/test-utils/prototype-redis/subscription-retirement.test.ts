import type { RedisClientType } from 'redis';
import { expect, it, vi } from 'vitest';
import { createGroup } from './fixture';

const routing = vi.hoisted(() => ({
  subscriber: undefined as ((client: unknown) => void) | undefined,
}));

vi.mock('redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('redis')>();
  return {
    ...actual,
    createClient: ((...args: Parameters<typeof actual.createClient>) => {
      const client = actual.createClient(...args);
      const name = args[0]?.name;
      if (typeof name === 'string' && name.endsWith(':subscriber')) routing.subscriber?.(client);
      return client;
    }) as typeof actual.createClient,
  };
});

it('rejects late subscription completion and drops delivery after its case closes', async () => {
  const group = await createGroup();
  const restores: Array<() => void> = [];
  let acknowledge!: () => void;
  let finishUnsubscribe!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const unsubscribeAllowed = new Promise<void>((resolve) => {
    finishUnsubscribe = resolve;
  });
  let realAcknowledgement = false;
  let caseCleanupStarted = false;
  let decodedMessages = 0;
  let acquisitionSettled = false;
  let acquisition: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let retired: Promise<unknown> | undefined;
  const messages: string[] = [];
  try {
    routing.subscriber = (captured) => {
      const subscriber = captured as RedisClientType;
      const subscribe = subscriber.subscribe.bind(subscriber);
      const unsubscribe = subscriber.unsubscribe.bind(subscriber);
      const subscribeSpy = vi
        .spyOn(subscriber, 'subscribe')
        .mockImplementation(async (channels, listener, bufferMode) => {
          await subscribe(
            channels,
            (message, channel) => {
              decodedMessages++;
              listener(message, channel);
            },
            bufferMode
          );
          realAcknowledgement = true;
          await acknowledgement;
        });
      restores.push(() => subscribeSpy.mockRestore());
      const unsubscribeSpy = vi
        .spyOn(subscriber, 'unsubscribe')
        .mockImplementation(async (...args) => {
          // The real subscription remains active while case cleanup has started.
          caseCleanupStarted = true;
          await unsubscribeAllowed;
          await unsubscribe(...args);
        });
      restores.push(() => unsubscribeSpy.mockRestore());
    };

    await group.runCase('survivor', async (peer) => {
      const key = peer.key('owned');
      await peer.client.set(key, 'survives');
      let channel = '';
      retired = group
        .runCase('retired', async (scope) => {
          channel = scope.channel('owned');
          acquisition = scope
            .subscribe(channel, (message) => messages.push(message))
            .then(
              () => ({ ok: true as const }),
              (error: unknown) => ({ ok: false as const, error })
            )
            .finally(() => {
              acquisitionSettled = true;
            });
          // Connection and server registration both finish before this callback returns.
          await expect.poll(() => realAcknowledgement, { timeout: 2000 }).toBe(true);
        })
        .catch((error: unknown) => error);

      await expect.poll(() => caseCleanupStarted, { timeout: 2000 }).toBe(true);
      expect(acquisitionSettled).toBe(false);
      expect(await peer.client.publish(channel, 'after case closure')).toBe(1);
      // A real Redis message must reach the subscriber before checking the fixture listener.
      await expect.poll(() => decodedMessages, { timeout: 2000 }).toBe(1);
      expect.soft(messages).toEqual([]);

      acknowledge();
      await expect.poll(() => acquisitionSettled, { timeout: 2000 }).toBe(true);
      const outcome = await acquisition;
      expect.soft(outcome).toMatchObject({ ok: false, error: expect.any(Error) });
      if (outcome && !outcome.ok) expect(String(outcome.error)).toContain('case is closed');
      finishUnsubscribe();
      expect(await retired).toBeUndefined();
      expect(await peer.client.get(key)).toBe('survives');
      expect((await peer.client.pubSubNumSub(channel))[channel]).toBe(0);
    });
  } finally {
    acknowledge();
    finishUnsubscribe();
    routing.subscriber = undefined;
    try {
      await group.close();
      await Promise.allSettled([acquisition, retired]);
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  }
}, 15000);
