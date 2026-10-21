// THROWAWAY, issue #435. No production exports or builder changes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { createClient, type RedisClientType } from 'redis';
import { getContainerRuntimeClient } from 'testcontainers';
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

function remaining(deadline: number) {
  return Math.max(1, deadline - performance.now());
}

function throwErrors(errors: unknown[], message: string) {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}

async function closeClient(client: RedisClientType, deadline: number) {
  const errors: unknown[] = [];
  try {
    // redis 4's quit() clears isOpen before its reply. Keep disconnect available.
    if (client.isOpen)
      await within(client.sendCommand(['QUIT']), remaining(deadline), 'Redis QUIT timed out');
  } catch (error) {
    errors.push(error);
  }
  try {
    if (client.isOpen)
      await within(client.disconnect(), remaining(deadline), 'Redis disconnect timed out');
  } catch (error) {
    errors.push(error);
  }
  throwErrors(errors, 'Redis client cleanup failed');
}

async function within<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createGroup(metrics = timing(), shutdownTimeoutMs = 3000) {
  assert.ok(Number.isFinite(shutdownTimeoutMs) && shutdownTimeoutMs > 0);
  const abort = new AbortController();
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
  const lifecycleDocker = (await getContainerRuntimeClient()).container.dockerode;
  const clients: RedisClientType[] = [];
  const keys = new Set<string>();
  const channels = new Set<string>();
  const pending = new Set<Promise<void>>();
  let closing = false;

  async function dockerRequest<T>(
    action: string,
    deadline: number,
    operation: (signal: AbortSignal) => Promise<T>
  ) {
    const cancellation = new AbortController();
    const timer = setTimeout(() => cancellation.abort(), remaining(deadline));
    try {
      return await operation(cancellation.signal);
    } catch (error) {
      const outcome = cancellation.signal.aborted ? 'timed out' : 'failed';
      throw new Error(`Docker ${action} ${outcome} for owned container ${id}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async function connect(name: string, owned: RedisClientType[], assertOpen: () => void) {
    assertOpen();
    const client: RedisClientType = createClient({
      url: tester.redis.config.endpoints.fromHost,
      name,
      socket: { reconnectStrategy: false, connectTimeout: 3000 },
    });
    owned.push(client);
    clients.push(client);
    // connect/commands reject normally; keep socket errors from becoming unhandled events.
    client.on('error', () => {});
    const open = client.connect.bind(client);
    // Retained clients cannot reopen after their case or group has closed.
    client.connect = async () => {
      assertOpen();
      await open();
      try {
        assertOpen();
      } catch (error) {
        if (client.isOpen) await client.disconnect();
        throw error;
      }
      return client;
    };
    await client.connect();
    return client;
  }

  async function runBody(scope: CaseScope, body: (scope: CaseScope) => Promise<void>) {
    abort.signal.throwIfAborted();
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(abort.signal.reason);
      abort.signal.addEventListener('abort', cancel, { once: true });
    });
    try {
      // Observe the callback's eventual rejection even when cancellation wins.
      await Promise.race([body(scope), cancelled]);
    } finally {
      abort.signal.removeEventListener('abort', cancel);
    }
  }

  return {
    runCase(name: string, body: (scope: CaseScope) => Promise<void>) {
      assert.equal(closing, false, 'group is closing');
      const task = (async () => {
        const prefix = `${owner}:${name}:${randomUUID()}`;
        const owned: RedisClientType[] = [];
        const ownedKeys = new Set<string>();
        const subscriptions: { client: RedisClientType; channel: string }[] = [];
        let closed = false;
        const assertOpen = () => {
          assert.equal(abort.signal.aborted, false, 'group is closed');
          assert.equal(closed, false, 'case is closed');
        };
        let client: RedisClientType | undefined;
        const errors: unknown[] = [];
        try {
          const setup = performance.now();
          try {
            client = await connect(prefix, owned, assertOpen);
          } finally {
            metrics.clientSetupMs += performance.now() - setup;
          }
          const scope: CaseScope = {
            client,
            key(suffix) {
              assertOpen();
              const key = `${prefix}:key:${suffix}`;
              ownedKeys.add(key);
              keys.add(key);
              return key;
            },
            channel(suffix) {
              assertOpen();
              const channel = `${prefix}:channel:${suffix}`;
              channels.add(channel);
              return channel;
            },
            async subscribe(channel, listener) {
              assertOpen();
              assert.ok(channels.has(channel) && channel.startsWith(prefix));
              const subscriber = await connect(`${prefix}:subscriber`, owned, assertOpen);
              assertOpen();
              subscriptions.push({ client: subscriber, channel });
              await subscriber.subscribe(channel, listener);
            },
          };
          const start = performance.now();
          try {
            await runBody(scope, body);
          } finally {
            metrics.bodyMs += performance.now() - start;
          }
        } catch (error) {
          errors.push(error);
        } finally {
          closed = true;
          const start = performance.now();
          const deadline = start + shutdownTimeoutMs;
          // Attempt every release even if a previous one fails. Never FLUSHALL.
          for (const subscription of subscriptions) {
            try {
              if (subscription.client.isOpen) {
                await within(
                  subscription.client.unsubscribe(subscription.channel),
                  remaining(deadline),
                  'Redis UNSUBSCRIBE timed out'
                );
              }
            } catch (error) {
              errors.push(error);
            }
          }
          try {
            if (ownedKeys.size && client?.isReady) {
              await within(client.del([...ownedKeys]), remaining(deadline), 'Redis DEL timed out');
            }
          } catch (error) {
            errors.push(error);
          }
          for (const connection of owned) {
            try {
              await closeClient(connection, deadline);
              metrics.clientsClosed++;
            } catch (error) {
              errors.push(error);
            }
          }
          metrics.scopedCleanupMs += performance.now() - start;
        }
        throwErrors(errors, 'case and cleanup failed');
      })();
      pending.add(task);
      // Return the finally chain, so a rejected case has no detached rejection.
      return task.finally(() => pending.delete(task));
    },
    async close() {
      closing = true;
      const deadline = performance.now() + shutdownTimeoutMs;
      // One aggregate bound, with Docker time reserved after the Redis window.
      const dockerDeadline = deadline + 5000;
      const verification = performance.now();
      let observer: RedisClientType | undefined;
      const errors: unknown[] = [];
      try {
        try {
          await within(
            Promise.allSettled([...pending]),
            remaining(deadline),
            'timed out waiting for pending cases'
          );
        } catch (error) {
          abort.abort(new Error('group is closed', { cause: error }));
          const errors = [error];
          try {
            const disconnected = await within(
              Promise.allSettled(
                clients.map(async (client) => {
                  if (client.isOpen) await client.disconnect();
                })
              ),
              remaining(deadline),
              'client disconnection timed out'
            );
            for (const result of disconnected) {
              if (result.status === 'rejected') errors.push(result.reason);
            }
          } catch (disconnectError) {
            errors.push(disconnectError);
          }
          try {
            await within(
              Promise.allSettled([...pending]),
              remaining(deadline),
              'pending cases cleanup timed out'
            );
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
          if (errors.length === 1) throw error;
          throw new AggregateError(errors, 'pending cases and cleanup failed');
        }
        abort.abort(new Error('group is closed'));
        assert.ok(
          clients.every((client) => !client.isOpen),
          'case clients closed before stop'
        );
        observer = createClient({
          url: tester.redis.config.endpoints.fromHost,
          socket: { reconnectStrategy: false, connectTimeout: 3000 },
        });
        observer.on('error', () => {});
        const inspect = observer;
        await within(
          (async () => {
            await inspect.connect();
            for (const key of keys) assert.equal(await inspect.exists(key), 0, `leaked key ${key}`);
            for (const channel of channels) {
              assert.equal(
                (await inspect.pubSubNumSub(channel))[channel],
                0,
                'leaked subscription'
              );
            }
            assert.ok(
              (await inspect.clientList()).every((client) => !client.name.startsWith(owner)),
              'owned client still visible to Redis'
            );
          })(),
          remaining(deadline),
          'Redis verification timed out'
        );
      } catch (error) {
        errors.push(error);
      }
      try {
        if (observer) await closeClient(observer, deadline);
      } catch (error) {
        errors.push(error);
      }
      metrics.verificationMs += performance.now() - verification;
      const start = performance.now();
      metrics.stopAttempts++;
      const container = lifecycleDocker.getContainer(id);
      try {
        // This prototype owns only Redis. Abort the actual HTTP request, not just its wait.
        await dockerRequest('stop', dockerDeadline - 2500, (signal) =>
          container.stop({ t: 0, abortSignal: signal })
        );
        metrics.stops++;
      } catch (error) {
        errors.push(error);
      }
      try {
        // Reserve the final 500 ms for verification, even when stopping fails.
        await dockerRequest('remove', dockerDeadline - 500, (signal) => {
          const options = { force: true, v: true, abortSignal: signal };
          return container.remove(options);
        });
      } catch (error) {
        errors.push(error);
      }
      metrics.containerCleanupMs += performance.now() - start;
      const removalCheck = performance.now();
      try {
        const containers = await dockerRequest('list', dockerDeadline, (signal) =>
          lifecycleDocker.listContainers({ all: true, abortSignal: signal })
        );
        assert.ok(
          !containers.some((container) => container.Id === id),
          `owned container ${id} still exists`
        );
        metrics.containersRemoved++;
      } catch (error) {
        errors.push(error);
      } finally {
        metrics.verificationMs += performance.now() - removalCheck;
      }
      throwErrors(errors, 'group cleanup failed');
    },
  };
}
