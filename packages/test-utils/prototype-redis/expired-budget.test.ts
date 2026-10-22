import { afterEach, beforeEach, expect, it, vi } from 'vitest';

interface ClientRecord {
  name: string;
  isOpen: boolean;
  readonly isReady: boolean;
  subscriptions: Set<string>;
  on(): ClientRecord;
  connect(): Promise<ClientRecord>;
  disconnect(): Promise<void>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  del(keys: string[]): Promise<number>;
  sendCommand(args: string[]): Promise<string>;
  exists(key: string): Promise<number>;
  pubSubNumSub(channel: string): Promise<Record<string, number>>;
  clientList(): Promise<Array<{ name: string }>>;
}

const state = vi.hoisted(() => ({
  clients: [] as ClientRecord[],
  commands: [] as Array<{ command: string; client: string; at: number }>,
  pendingGraceful: [] as Array<() => void>,
  firstUnsubscribe: undefined as (() => void) | undefined,
  paused: false,
  containerExists: false,
}));

vi.mock('redis', () => {
  function graceful<T>(command: string, client: ClientRecord, complete: () => T): Promise<T> {
    state.commands.push({ command, client: client.name, at: performance.now() });
    if (command === 'UNSUBSCRIBE') {
      state.firstUnsubscribe?.();
      state.firstUnsubscribe = undefined;
    }
    if (!state.paused) return Promise.resolve(complete());
    return new Promise<T>((resolve) => {
      state.pendingGraceful.push(() => resolve(complete()));
    });
  }

  return {
    createClient(options: { name?: string }) {
      const client: ClientRecord = {
        name: options.name ?? '',
        isOpen: false,
        get isReady() {
          return client.isOpen;
        },
        subscriptions: new Set<string>(),
        on() {
          return client;
        },
        async connect() {
          client.isOpen = true;
          return client;
        },
        async disconnect() {
          // node-redis v4 closes its physical socket synchronously before awaiting pool drainage.
          client.isOpen = false;
          client.subscriptions.clear();
        },
        async subscribe(channel) {
          client.subscriptions.add(channel);
        },
        unsubscribe(channel) {
          return graceful('UNSUBSCRIBE', client, () => {
            client.subscriptions.delete(channel);
          });
        },
        del() {
          return graceful('DEL', client, () => 0);
        },
        sendCommand(args) {
          return graceful(args[0], client, () => {
            if (args[0] === 'QUIT') {
              client.isOpen = false;
              client.subscriptions.clear();
            }
            return 'OK';
          });
        },
        async exists() {
          return 0;
        },
        async pubSubNumSub(channel) {
          return {
            [channel]: state.clients.filter(
              (owned) => owned.isOpen && owned.subscriptions.has(channel)
            ).length,
          };
        },
        async clientList() {
          return state.clients.filter((owned) => owned.isOpen).map(({ name }) => ({ name }));
        },
      };
      state.clients.push(client);
      return client;
    },
  };
});

vi.mock('../src/index', () => {
  class Tester {
    redis = {
      config: {
        container: { getId: () => 'owned-test-container' },
        endpoints: { fromHost: 'redis://controlled.invalid:6379' },
      },
    };
    withRedis() {
      return this;
    }
    async setup() {
      state.containerExists = true;
      return this;
    }
    async destroy() {
      state.containerExists = false;
    }
  }
  return {
    createDefaultTesterBuilder() {
      const builder = {
        with() {
          return builder;
        },
        build() {
          return Tester;
        },
      };
      return builder;
    },
    DockerTesterBuilder: class {},
    RedisTesterBuilder: class {},
  };
});

vi.mock('testcontainers', () => ({
  async getContainerRuntimeClient() {
    return {
      container: {
        dockerode: {
          getContainer() {
            return {
              async stop() {},
              async remove() {
                state.containerExists = false;
              },
            };
          },
          async listContainers() {
            return state.containerExists ? [{ Id: 'owned-test-container' }] : [];
          },
        },
      },
    };
  },
}));

import { createGroup, timing } from './fixture';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  state.clients.length = 0;
  state.commands.length = 0;
  state.pendingGraceful.length = 0;
  state.firstUnsubscribe = undefined;
  state.paused = false;
  state.containerExists = false;
});

afterEach(() => {
  vi.useRealTimers();
});

it.each([2, 32])('stops graceful work at one deadline with %i subscriptions', async (count) => {
  const budget = 20;
  const group = await createGroup(timing(), budget);
  let deadline = 0;
  const firstUnsubscribe = new Promise<void>((resolve) => {
    state.firstUnsubscribe = resolve;
  });
  const outcome = group
    .runCase('expired-budget', async (scope) => {
      for (let index = 0; index < count; index++) {
        await scope.subscribe(scope.channel(String(index)), () => {});
      }
      state.paused = true;
      deadline = performance.now() + budget;
      throw new Error('intentional body failure');
    })
    .catch((error: unknown) => error);

  try {
    await firstUnsubscribe;
    await vi.advanceTimersByTimeAsync(budget);
    // These are observable adapter effects, not a fragile elapsed-time assertion.
    expect({
      commandsAfterDeadline: state.commands.filter(({ at }) => at >= deadline),
      openClients: state.clients.filter(({ isOpen }) => isOpen).length,
    }).toEqual({ commandsAfterDeadline: [], openClients: 0 });
    const error = await outcome;
    expect(error).toBeInstanceOf(AggregateError);
    const messages = (error as AggregateError).errors.map(String).join(' ');
    expect(messages).toContain('intentional body failure');
    expect(messages).toContain('timed out');
  } finally {
    // This also lets the unfixed implementation finish after the expected red assertion.
    state.paused = false;
    for (const release of state.pendingGraceful.splice(0)) release();
    await outcome;
    await group.close();
  }
});
