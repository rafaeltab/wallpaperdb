import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
import {
  Creation,
  WorkflowDelivery,
  WorkflowFailure,
  WorkflowHealth,
  type WorkflowPublication,
} from '../src/capabilities/creation/index.js';

const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('nats', async (original) => ({
  ...(await original<typeof import('nats')>()),
  connect: transport.connect,
}));
afterEach(() => vi.useRealTimers());

it.each(['confirmation-success', 'confirmation-retry', 'outbox-success', 'outbox-retry'] as const)(
  'drains ready workflow work immediately after success and preserves idle/retry backoff (%s)',
  async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pollMs = 1000;
    const outbox = scenario.startsWith('outbox');
    const retry = scenario.endsWith('retry');
    const publications: WorkflowPublication[] = ['first', 'second'].map((id) => ({
      id,
      wallpaperId: id,
      destination: 'asset-create',
      event: { id },
      leaseId: `lease-${id}`,
      attempts: 0,
    }));
    const claimed = vi.fn(() => Effect.sync(() => (outbox ? publications.splice(0, 1) : [])));
    const published: string[] = [];
    const applied: string[] = [];
    const acknowledged: string[] = [];
    const negativeAcknowledgements = vi.fn();
    let failApplication = retry;
    let cursor = 0;
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
        cursor++;
      },
      nak: negativeAcknowledgements,
    }));
    const next = vi.fn(async () => (outbox ? null : (ready[cursor] ?? null)));
    const requests = outbox ? claimed : next;
    const acknowledgements = outbox ? published : acknowledged;
    transport.connect.mockResolvedValue({
      jetstream: () => ({
        consumers: { get: async () => ({ next }) },
        publish: async (_subject: string, _body: string, options: { msgID: string }) => {
          if (failApplication) {
            failApplication = false;
            throw new Error('Injected publish failure');
          }
          published.push(options.msgID.replace('https://wallpaperdb/wallpaper#', ''));
          return { stream: 'ASSET_COMMANDS', seq: published.length, duplicate: false };
        },
      }),
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
                Effect.suspend(() => {
                  if (failApplication) {
                    failApplication = false;
                    return Effect.fail(
                      new WorkflowFailure({ operation: 'apply-fixture', cause: 'injected' })
                    );
                  }
                  applied.push(result.wallpaperId);
                  return Effect.succeed('applied' as const);
                }),
              sourceAccepted: unexpected,
            }),
            Layer.succeed(WorkflowDelivery, {
              claim: claimed,
              alerts: () => Effect.succeed([]),
              complete: (publication) =>
                Effect.sync(() => {
                  applied.push(publication.wallpaperId);
                }),
              failed: (publication) =>
                Effect.sync(() => {
                  publications.unshift({ ...publication, attempts: publication.attempts + 1 });
                }),
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
      expect(await runtime.runPromise(health.check())).toBe(outbox || !retry);
      expect(acknowledgements).toEqual(applied);
      expect(negativeAcknowledgements.mock.calls).toEqual(retry && !outbox ? [[100]] : []);
      const fetchesAtZero = requests.mock.calls.length;
      atZero = [...applied];
      await vi.advanceTimersByTimeAsync(pollMs - 1);
      beforePoll = [...applied];
      expect(requests).toHaveBeenCalledTimes(fetchesAtZero);
      await vi.advanceTimersByTimeAsync(1);
      // Failed work resumes after backoff; successful work has already drained at time zero.
      expect(applied).toEqual(['first', 'second']);
      expect(acknowledgements).toEqual(['first', 'second']);
      expect(negativeAcknowledgements.mock.calls).toEqual(retry && !outbox ? [[100]] : []);
      expect(outbox ? publications.length : ready.length - cursor).toBe(0);
    } finally {
      const fetchesAtShutdown = requests.mock.calls.length;
      const disposing = runtime.dispose();
      await vi.advanceTimersByTimeAsync(2000);
      await disposing;
      expect(requests).toHaveBeenCalledTimes(fetchesAtShutdown);
    }
    const expectedBeforePoll = !retry ? ['first', 'second'] : [];
    expect
      .soft(atZero, 'successful work drains at time zero; failures retain backoff')
      .toEqual(expectedBeforePoll);
    expect(beforePoll, 'only idle or failed work should wait for pollMs').toEqual(
      expectedBeforePoll
    );
  }
);
