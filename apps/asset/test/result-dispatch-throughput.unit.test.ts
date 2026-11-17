import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { protectedCommandsLayer, ProtectedCommandHealth } from '../src/adapters/commands/index.js';
import {
  Lifecycle,
  ResultOutbox,
  type ResultPublication,
} from '../src/capabilities/lifecycle/index.js';

const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('nats', async (original) => ({
  ...(await original<typeof import('nats')>()),
  connect: transport.connect,
}));
afterEach(() => vi.useRealTimers());

it.each(['success', 'retry'] as const)(
  'drains ready results immediately after success and preserves idle/retry backoff (%s)',
  async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pollMs = 1000;
    const ready: ResultPublication[] = ['first', 'second'].map((id) => ({
      id,
      leaseId: `lease-${id}`,
      applicationId: 'wallpaper',
      attempts: 0,
      occurredAt: '2026-11-17T00:00:00.000Z',
      context: { occurrence: { source: 'https://wallpaperdb/wallpaper', id: `create-${id}` } },
      result: {
        outcome: 'created',
        assetId: `asset-${id}`,
        commandId: `command-${id}`,
        applicationReference: id,
      },
    }));
    const completed: string[] = [];
    const published: string[] = [];
    const failures: string[] = [];
    let failPublication = scenario === 'retry';
    const claim = vi.fn((limit: number) => Effect.sync(() => ready.splice(0, limit)));
    let stop = () => {};
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const messages = {
      stop,
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            await stopped;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const publish = vi.fn(async (_subject: string, _body: string, options: { msgID: string }) => {
      if (failPublication) {
        failPublication = false;
        throw new Error('Injected publication failure');
      }
      published.push(options.msgID);
      return { stream: 'ASSET_RESULTS', seq: published.length, duplicate: false };
    });
    transport.connect.mockResolvedValue({
      jetstreamManager: async () => ({
        streams: {
          info: async () => ({
            config: {
              subjects: ['asset.commands.wallpaper.create', 'asset.commands.wallpaper.delete'],
            },
          }),
        },
        consumers: {
          info: async () => ({
            config: { filter_subject: 'asset.commands.wallpaper.*', max_deliver: -1 },
          }),
        },
      }),
      jetstream: () => ({
        publish,
        consumers: { get: async () => ({ consume: async () => messages }) },
      }),
      drain: async () => {},
      close: async () => {},
      isClosed: () => false,
    });
    const unexpected = () =>
      Effect.die('Unexpected failure/recovery path in successful result fixture');
    const runtime = ManagedRuntime.make(
      protectedCommandsLayer({
        url: 'nats://controlled.test:4222',
        credential: { user: 'test', password: 'test' },
        applications: {
          wallpaper: {
            id: 'wallpaper',
            createSubject: 'asset.commands.wallpaper.create',
            deleteSubject: 'asset.commands.wallpaper.delete',
            resultSubject: 'asset.results.wallpaper',
            serviceUser: 'test',
          },
        },
        maxAttempts: 3,
        retryDelayMs: 100,
        pollMs,
        shutdownTimeoutMs: 2000,
        maxAckPending: 1,
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(Lifecycle, { command: unexpected, inspect: unexpected }),
            Layer.succeed(ResultOutbox, {
              claim,
              published: (publication) =>
                Effect.sync(() => {
                  completed.push(publication.id);
                }),
              failed: (publication) =>
                Effect.sync(() => {
                  failures.push(publication.id);
                  ready.unshift({ ...publication, attempts: publication.attempts + 1 });
                }),
              pendingAlerts: () => Effect.succeed([]),
              alerted: unexpected,
              recover: unexpected,
            })
          )
        )
      )
    );
    let atZero: string[] = [];
    let beforePoll: string[] = [];
    try {
      const started = runtime.runPromise(ProtectedCommandHealth);
      // Drain all runnable work and resolved transport promises without advancing time.
      await vi.advanceTimersByTimeAsync(0);
      const health = await started;
      expect(await runtime.runPromise(health.check())).toBe(scenario === 'success');
      expect(published).toEqual(completed);
      expect(failures).toEqual(scenario === 'retry' ? ['first'] : []);
      const claimsAtZero = claim.mock.calls.length;
      atZero = [...completed];
      await vi.advanceTimersByTimeAsync(pollMs - 1);
      beforePoll = [...completed];
      expect(claim).toHaveBeenCalledTimes(claimsAtZero);
      await vi.advanceTimersByTimeAsync(1);
      // Failed work resumes after backoff; successful work has already drained at time zero.
      expect(completed).toEqual(['first', 'second']);
      expect(published).toEqual(['first', 'second']);
      expect(ready).toEqual([]);
    } finally {
      const claimsAtShutdown = claim.mock.calls.length;
      const disposing = runtime.dispose();
      await vi.advanceTimersByTimeAsync(2000);
      await disposing;
      expect(claim).toHaveBeenCalledTimes(claimsAtShutdown);
    }
    const expectedBeforePoll = scenario === 'success' ? ['first', 'second'] : [];
    expect
      .soft(atZero, 'successful work drains at time zero; failures retain backoff')
      .toEqual(expectedBeforePoll);
    expect(beforePoll, 'only idle or failed work should wait for pollMs').toEqual(
      expectedBeforePoll
    );
  }
);
