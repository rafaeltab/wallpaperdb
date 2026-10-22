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

function throwErrors(errors: unknown[], message: string) {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}

async function within<T>(operation: () => Promise<T>, deadline: number, message: string) {
  const timeoutMs = deadline - performance.now();
  // Check before calling the operation, so an expired budget starts no new commands.
  if (timeoutMs <= 0) throw new Error(message);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
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
  const cancellations = new WeakMap<RedisClientType, AbortController>();
  let closing = false;
  let shutdownDeadline = Number.POSITIVE_INFINITY;

  function newClient(name?: string) {
    const cancellation = new AbortController();
    // node-redis forwards this object to net.connect, including its native signal.
    const socket = {
      reconnectStrategy: false as const,
      connectTimeout: 3000,
      signal: cancellation.signal,
    };
    const client: RedisClientType = createClient({
      url: tester.redis.config.endpoints.fromHost,
      name,
      socket,
    });
    cancellations.set(client, cancellation);
    // Commands reject normally; socket error events must also have an observer.
    client.on('error', () => {});
    return client;
  }

  function forceClients(connections: RedisClientType[]) {
    // Abort the actual transport even when Redis has not stored a connecting socket yet.
    // Invoke every cancellation before awaiting pool drainage or another client.
    return Promise.allSettled(
      connections.map(async (client) => {
        cancellations.get(client)?.abort();
        if (client.isOpen) await client.disconnect();
      })
    );
  }

  async function closeClients(connections: RedisClientType[], deadline: number) {
    const errors: unknown[] = [];
    try {
      for (const client of connections) {
        if (!client.isOpen) continue;
        try {
          // redis 4's quit() clears isOpen before its reply. Keep disconnect available.
          await within(() => client.sendCommand(['QUIT']), deadline, 'Redis QUIT timed out');
        } catch (error) {
          errors.push(error);
          if (performance.now() >= deadline) break;
        }
      }
    } finally {
      const disconnected = forceClients(connections);
      try {
        const results = await within(() => disconnected, deadline, 'Redis disconnect timed out');
        for (const result of results) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    throwErrors(errors, 'Redis client cleanup failed');
  }

  async function dockerRequest<T>(
    action: string,
    deadline: number,
    operation: (signal: AbortSignal) => Promise<T>
  ) {
    const cancellation = new AbortController();
    const remaining = deadline - performance.now();
    if (remaining <= 0) cancellation.abort();
    const timer = remaining > 0 ? setTimeout(() => cancellation.abort(), remaining) : undefined;
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
    const client = newClient(name);
    owned.push(client);
    clients.push(client);
    const open = client.connect.bind(client);
    // Retained clients cannot reopen after their case or group has closed.
    client.connect = async () => {
      assertOpen();
      await open();
      try {
        assertOpen();
      } catch (error) {
        await forceClients([client]);
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
              await subscriber.subscribe(channel, (message) => {
                if (!closed && !abort.signal.aborted) listener(message);
              });
              assertOpen();
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
          const deadline = Math.min(start + shutdownTimeoutMs, shutdownDeadline);
          // Attempt every release even if a previous one fails. Never FLUSHALL.
          for (const subscription of subscriptions) {
            try {
              if (subscription.client.isOpen) {
                await within(
                  () => subscription.client.unsubscribe(subscription.channel),
                  deadline,
                  'Redis UNSUBSCRIBE timed out'
                );
              }
            } catch (error) {
              errors.push(error);
              if (performance.now() >= deadline) break;
            }
          }
          // Close user command access before the final DEL. A retained raw client's
          // detached SET can otherwise be queued between DEL and QUIT.
          try {
            await closeClients(owned, deadline);
            metrics.clientsClosed += owned.length;
          } catch (error) {
            errors.push(error);
          }
          const cleanup: RedisClientType[] = [];
          try {
            if (ownedKeys.size) {
              const cleaner = await within(
                () => connect(`${prefix}:cleanup`, cleanup, () => abort.signal.throwIfAborted()),
                deadline,
                'Redis cleanup connection timed out'
              );
              await within(() => cleaner.del([...ownedKeys]), deadline, 'Redis DEL timed out');
            }
          } catch (error) {
            errors.push(error);
          } finally {
            if (cleanup.length) {
              try {
                await closeClients(cleanup, deadline);
                metrics.clientsClosed += cleanup.length;
              } catch (error) {
                errors.push(error);
              }
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
      shutdownDeadline = deadline;
      // One aggregate bound, with Docker time reserved after the Redis window.
      const dockerDeadline = deadline + 5000;
      const verification = performance.now();
      let observer: RedisClientType | undefined;
      const errors: unknown[] = [];
      try {
        try {
          await within(
            () => Promise.allSettled([...pending]),
            deadline,
            'timed out waiting for pending cases'
          );
        } catch (error) {
          abort.abort(new Error('group is closed', { cause: error }));
          const errors = [error];
          const forced = forceClients(clients);
          try {
            const disconnected = await within(
              () => forced,
              deadline,
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
              () => Promise.allSettled([...pending]),
              deadline,
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
        observer = newClient();
        const inspect = observer;
        await within(() => inspect.connect(), deadline, 'Redis verification timed out');
        for (const key of keys) {
          const exists = await within(
            () => inspect.exists(key),
            deadline,
            'Redis verification timed out'
          );
          assert.equal(exists, 0, `leaked key ${key}`);
        }
        for (const channel of channels) {
          const subscriptions = await within(
            () => inspect.pubSubNumSub(channel),
            deadline,
            'Redis verification timed out'
          );
          assert.equal(subscriptions[channel], 0, 'leaked subscription');
        }
        const visible = await within(
          () => inspect.clientList(),
          deadline,
          'Redis verification timed out'
        );
        assert.ok(
          visible.every((client) => !client.name.startsWith(owner)),
          'owned client still visible to Redis'
        );
      } catch (error) {
        errors.push(error);
      }
      try {
        if (observer) await closeClients([observer], deadline);
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
