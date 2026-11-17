import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
import { Creation, WorkflowDelivery, WorkflowHealth } from '../src/capabilities/creation/index.js';

const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('nats', async (original) => ({
  ...(await original<typeof import('nats')>()),
  connect: transport.connect,
}));
afterEach(() => vi.useRealTimers());

it('continues applying ready successful confirmations without waiting for the idle poll interval', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pollMs = 1000;
  const applied: string[] = [];
  const acknowledged: string[] = [];
  const negativeAcknowledgements = vi.fn();
  const ready = ['first', 'second'].map((id) => ({
    subject: 'asset.results.wallpaper',
    data: new TextEncoder().encode(
      JSON.stringify({
        specversion: '1.0',
        id: `result-${id}`,
        source: 'https://wallpaperdb/asset',
        type: 'asset.command.result',
        time: '2026-11-17T00:00:00.000Z',
        datacontenttype: 'application/json',
        causationsource: 'https://wallpaperdb/wallpaper',
        causationid: `create-${id}`,
        data: {
          commandId: `command-${id}`,
          applicationReference: id,
          outcome: 'created',
          assetId: `asset-${id}`,
        },
      })
    ),
    info: { redeliveryCount: 0, deliveryCount: 1, consumer: 'results_wallpaper' },
    ack: () => {
      acknowledged.push(id);
    },
    nak: negativeAcknowledgements,
  }));
  const next = vi.fn(async () => ready.shift() ?? null);
  transport.connect.mockResolvedValue({
    jetstream: () => ({ consumers: { get: async () => ({ next }) } }),
    drain: async () => {},
    close: async () => {},
    isClosed: () => false,
  });
  const unexpected = () =>
    Effect.die('Unexpected failure/recovery path in successful confirmation fixture');
  const runtime = ManagedRuntime.make(
    assetWorkflowLayer({
      natsUrl: 'nats://controlled.test:4222',
      ownerNamespace: 'authors',
      credential: { user: 'test', password: 'test' },
      identityProviders: [],
      operatorNotification: { url: 'https://controlled.test/events', token: 'test' },
      maxAttempts: 3,
      retryDelayMs: 100,
      pollMs,
      shutdownTimeoutMs: 2000,
    }).pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(Creation, {
            list: unexpected,
            begin: unexpected,
            get: unexpected,
            expectSource: unexpected,
            assetResult: (result) =>
              Effect.sync(() => {
                applied.push(result.wallpaperId);
                return 'applied' as const;
              }),
            sourceAccepted: unexpected,
          }),
          Layer.succeed(WorkflowDelivery, {
            claim: () => Effect.succeed([]),
            alerts: () => Effect.succeed([]),
            complete: unexpected,
            failed: unexpected,
            alerted: unexpected,
            retainedConfirmation: unexpected,
            confirmationRecovered: unexpected,
            quarantine: unexpected,
            recover: unexpected,
          })
        )
      )
    )
  );
  let atZero: string[] = [];
  let beforePoll: string[] = [];
  try {
    const started = runtime.runPromise(WorkflowHealth);
    // Drain all runnable work and resolved transport promises without advancing time.
    await vi.advanceTimersByTimeAsync(0);
    const health = await started;
    expect(await runtime.runPromise(health.check())).toBe(true);
    expect(acknowledged).toEqual(applied);
    expect(applied[0]).toBe('first');
    atZero = [...applied];
    await vi.advanceTimersByTimeAsync(pollMs - 1);
    beforePoll = [...applied];
    await vi.advanceTimersByTimeAsync(1);
    // Diagnostic: the identical second message succeeds when only fake time changes.
    expect(applied).toEqual(['first', 'second']);
    expect(acknowledged).toEqual(['first', 'second']);
    expect(negativeAcknowledgements).not.toHaveBeenCalled();
    expect(ready).toEqual([]);
  } finally {
    const disposing = runtime.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    await disposing;
  }
  // This contract applies only to successful work with another item ready.
  // It imposes no requirement on idle backoff, retries or cancellation.
  expect
    .soft(atZero, 'both ready confirmations should apply at fake time 0')
    .toEqual(['first', 'second']);
  expect(beforePoll, 'successful confirmations must not wait for pollMs').toEqual([
    'first',
    'second',
  ]);
});
