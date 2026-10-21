// THROWAWAY, issue #435. No production exports or builder changes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { createClient, type RedisClientType } from 'redis';
import { createDefaultTesterBuilder, DockerTesterBuilder, RedisTesterBuilder } from '../src/index';

export const image = 'redis:7-alpine';
export const docker = new Docker();
const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(RedisTesterBuilder)
  .build();

export function timing() {
  return {
    startAttempts: 0,
    starts: 0,
    stopAttempts: 0,
    stops: 0,
    startupReadinessMs: 0,
    clientSetupMs: 0,
    bodyMs: 0,
    scopedCleanupMs: 0,
    verificationMs: 0,
    containerCleanupMs: 0,
    clientsClosed: 0,
    containersRemoved: 0,
  };
}

export interface CaseScope {
  client: RedisClientType;
  key(name: string): string;
  channel(name: string): string;
  subscribe(channel: string, listener: (message: string) => void): Promise<void>;
}

async function closeClient(client: RedisClientType) {
  try {
    if (client.isOpen) await client.quit();
  } finally {
    if (client.isOpen) await client.disconnect();
  }
}

export async function createGroup(metrics = timing()) {
  const owner = randomUUID();
  const tester = new Tester().withRedis((builder) => builder.withImage(image));
  const startup = performance.now();
  metrics.startAttempts++;
  try {
    await tester.setup();
    metrics.starts++;
  } catch (error) {
    await tester.destroy();
    throw error;
  } finally {
    metrics.startupReadinessMs += performance.now() - startup;
  }
  const id = tester.redis.config.container.getId();
  const clients: RedisClientType[] = [];
  const keys = new Set<string>();
  const channels = new Set<string>();
  const pending = new Set<Promise<void>>();
  let closing = false;

  async function connect(name: string, owned: RedisClientType[]) {
    const client: RedisClientType = createClient({
      url: tester.redis.config.endpoints.fromHost,
      name,
      socket: { reconnectStrategy: false, connectTimeout: 3000 },
    });
    owned.push(client);
    clients.push(client);
    // connect/commands reject normally; keep socket errors from becoming unhandled events.
    client.on('error', () => {});
    await client.connect();
    return client;
  }

  return {
    runCase(name: string, body: (scope: CaseScope) => Promise<void>) {
      assert.equal(closing, false, 'group is closing');
      const task = (async () => {
        const prefix = `${owner}:${name}:${randomUUID()}`;
        const owned: RedisClientType[] = [];
        const ownedKeys = new Set<string>();
        const subscriptions: { client: RedisClientType; channel: string }[] = [];
        let client: RedisClientType | undefined;
        const errors: unknown[] = [];
        try {
          const setup = performance.now();
          try {
            client = await connect(prefix, owned);
          } finally {
            metrics.clientSetupMs += performance.now() - setup;
          }
          const scope: CaseScope = {
            client,
            key(suffix) {
              const key = `${prefix}:key:${suffix}`;
              ownedKeys.add(key);
              keys.add(key);
              return key;
            },
            channel(suffix) {
              const channel = `${prefix}:channel:${suffix}`;
              channels.add(channel);
              return channel;
            },
            async subscribe(channel, listener) {
              assert.ok(channels.has(channel) && channel.startsWith(prefix));
              const subscriber = await connect(`${prefix}:subscriber`, owned);
              subscriptions.push({ client: subscriber, channel });
              await subscriber.subscribe(channel, listener);
            },
          };
          const start = performance.now();
          try {
            await body(scope);
          } finally {
            metrics.bodyMs += performance.now() - start;
          }
        } catch (error) {
          errors.push(error);
        } finally {
          const start = performance.now();
          // Attempt every release even if a previous one fails. Never FLUSHALL.
          for (const subscription of subscriptions) {
            try {
              await subscription.client.unsubscribe(subscription.channel);
            } catch (error) {
              errors.push(error);
            }
          }
          try {
            if (ownedKeys.size && client?.isReady) await client.del([...ownedKeys]);
          } catch (error) {
            errors.push(error);
          }
          for (const connection of owned) {
            try {
              await closeClient(connection);
              metrics.clientsClosed++;
            } catch (error) {
              errors.push(error);
            }
          }
          metrics.scopedCleanupMs += performance.now() - start;
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'case and cleanup failed');
      })();
      pending.add(task);
      // Return the finally chain, so a rejected case has no detached rejection.
      return task.finally(() => pending.delete(task));
    },
    async close() {
      closing = true;
      await Promise.allSettled([...pending]);
      const verification = performance.now();
      let observer: RedisClientType | undefined;
      try {
        assert.ok(
          clients.every((client) => !client.isOpen),
          'case clients closed before stop'
        );
        observer = createClient({
          url: tester.redis.config.endpoints.fromHost,
          socket: { reconnectStrategy: false, connectTimeout: 3000 },
        });
        observer.on('error', () => {});
        await observer.connect();
        for (const key of keys) assert.equal(await observer.exists(key), 0, `leaked key ${key}`);
        for (const channel of channels) {
          assert.equal((await observer.pubSubNumSub(channel))[channel], 0, 'leaked subscription');
        }
        assert.ok(
          (await observer.clientList()).every((client) => !client.name.startsWith(owner)),
          'owned client still visible to Redis'
        );
      } finally {
        try {
          if (observer) await closeClient(observer);
        } finally {
          metrics.verificationMs += performance.now() - verification;
          const start = performance.now();
          metrics.stopAttempts++;
          try {
            await tester.destroy();
            metrics.stops++;
          } finally {
            metrics.containerCleanupMs += performance.now() - start;
          }
          const removalCheck = performance.now();
          try {
            assert.ok(
              !(await docker.listContainers({ all: true })).some(
                (container) => container.Id === id
              ),
              'owned container still exists'
            );
          } finally {
            metrics.verificationMs += performance.now() - removalCheck;
          }
          metrics.containersRemoved++;
        }
      }
    },
  };
}
