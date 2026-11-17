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

it('continues publishing ready successful results without waiting for the idle poll interval', async () => {
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
            claim: (limit) => Effect.sync(() => ready.splice(0, limit)),
            published: (publication) =>
              Effect.sync(() => {
                completed.push(publication.id);
              }),
            failed: unexpected,
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
    expect(await runtime.runPromise(health.check())).toBe(true);
    expect(published).toEqual(completed);
    expect(completed[0]).toBe('first');
    atZero = [...completed];
    await vi.advanceTimersByTimeAsync(pollMs - 1);
    beforePoll = [...completed];
    await vi.advanceTimersByTimeAsync(1);
    // Diagnostic: the identical second item succeeds when only fake time changes.
    expect(completed).toEqual(['first', 'second']);
    expect(published).toEqual(['first', 'second']);
    expect(ready).toEqual([]);
  } finally {
    const disposing = runtime.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    await disposing;
  }
  // This contract applies only to successful work with another item ready.
  // It imposes no requirement on idle backoff, retries or cancellation.
  expect
    .soft(atZero, 'both ready results should complete at fake time 0')
    .toEqual(['first', 'second']);
  expect(beforePoll, 'successful results must not wait for pollMs').toEqual(['first', 'second']);
});
