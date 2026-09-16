import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { metrics } from '@opentelemetry/api';
import { DiscardPolicy, StorageType } from 'nats';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  natsProjectionLayer,
  NatsProjectionConsumer,
  type NatsProjectionOptions,
} from '../src/adapters/events/index.js';
import {
  ProjectCatalogue,
  ProjectionUnavailable,
  type ProjectionChange,
  type ProjectionOutcome,
} from '../src/projection/index.js';

const timestamp = '2026-09-15T12:00:00.000Z';

function upload(id: string): string {
  return JSON.stringify({
    eventId: id,
    eventType: 'wallpaper.uploaded',
    timestamp,
    wallpaper: {
      id: 'wlpr_nats_contract',
      userId: 'user_nats_contract',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSizeBytes: 100,
      width: 100,
      height: 100,
      aspectRatio: 1,
      storageKey: 'wallpaper.jpg',
      storageBucket: 'wallpapers',
      originalFilename: 'wallpaper.jpg',
      uploadedAt: timestamp,
    },
  });
}

class ControlledProjection implements ProjectCatalogue {
  readonly changes: ProjectionChange[] = [];
  outcomes: Array<ProjectionOutcome | ProjectionUnavailable> = [];
  nextEffect: Effect.Effect<ProjectionOutcome, ProjectionUnavailable> | undefined;
  defectNext = false;

  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome, ProjectionUnavailable> {
    return Effect.suspend(() => {
      this.changes.push(change);
      if (this.defectNext) {
        this.defectNext = false;
        return Effect.die(new Error('controlled unexpected defect'));
      }
      if (this.nextEffect) {
        const effect = this.nextEffect;
        this.nextEffect = undefined;
        return effect;
      }
      const outcome = this.outcomes.shift() ?? { _tag: 'Completed' };
      return outcome instanceof ProjectionUnavailable
        ? Effect.fail(outcome)
        : Effect.succeed(outcome);
    });
  }
}

describe('NATS projection adapter contract', () => {
  const Tester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(NatsTesterBuilder)
    .build();
  const tester = new Tester()
    .withNats((nats) => nats.withJetstream())
    .withStream('WALLPAPER')
    .withStream('PROFILE');
  const consumers: Array<ManagedRuntime.ManagedRuntime<NatsProjectionConsumer, unknown>> = [];
  beforeAll(async () => {
    await tester.setup();
  });
  afterAll(async () => {
    await tester.destroy();
  });
  afterEach(async () => {
    await Promise.all(consumers.splice(0).map((consumer) => consumer.dispose()));
    await tester.nats.purgeAllStreams();
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    try {
      await manager.streams.purge('GATEWAY_QUARANTINE');
    } catch {
      /* A startup failure may precede quarantine creation. */
    }
  });

  async function consumer(project: ProjectCatalogue, options: Partial<NatsProjectionOptions> = {}) {
    const runtime = ManagedRuntime.make(
      natsProjectionLayer({
        url: tester.nats.config.endpoints.fromHost,
        retryDelayMs: 5,
        ...options,
      }).pipe(Layer.provide(Layer.succeed(ProjectCatalogue, project)))
    );
    consumers.push(runtime);
    const adapter = await runtime.runPromise(NatsProjectionConsumer);
    return { runtime, adapter };
  }

  async function publish(payload: string): Promise<void> {
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', payload);
  }

  async function acknowledged(): Promise<void> {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(
        async () => {
          const info = await manager.consumers.info('WALLPAPER', 'gateway-wallpaper-uploaded');
          return { waiting: info.num_pending, unacknowledged: info.num_ack_pending };
        },
        { timeout: 10000, interval: 20 }
      )
      .toEqual({ waiting: 0, unacknowledged: 0 });
  }

  async function quarantine() {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('GATEWAY_QUARANTINE')).state.messages, {
        timeout: 10000,
        interval: 20,
      })
      .toBe(1);
    const message = await manager.streams.getMessage('GATEWAY_QUARANTINE', {
      last_by_subj: 'gateway.quarantine',
    });
    return JSON.parse(new TextDecoder().decode(message.data));
  }

  it('continues acknowledging subsequent deliveries when metric recording fails', async () => {
    const project = new ControlledProjection();
    const { adapter } = await consumer(project);
    metrics.setGlobalMeterProvider({
      getMeter() {
        throw new Error('Metrics unavailable');
      },
    });
    try {
      await publish(upload('metrics-first'));
      await acknowledged();
      await publish(upload('metrics-second'));
      await acknowledged();
      expect(project.changes).toHaveLength(2);
      expect(await Effect.runPromise(adapter.check())).toBe(true);
    } finally {
      metrics.disable();
    }
  });

  it('owns connection lifecycle and recovers existing durable subscriptions on restart', async () => {
    const { runtime, adapter } = await consumer(new ControlledProjection());
    expect(await Effect.runPromise(adapter.check())).toBe(true);
    await runtime.dispose();
    expect(await Effect.runPromise(adapter.check())).toBe(false);
    const restarted = await consumer(new ControlledProjection());
    expect(await Effect.runPromise(restarted.adapter.check())).toBe(true);
  });

  it('allows an active delivery to finish before releasing the broker connection', async () => {
    const project = new ControlledProjection();
    const release = Effect.runSync(Deferred.make<void>());
    project.nextEffect = Deferred.await(release).pipe(
      Effect.as({ _tag: 'Completed' } satisfies ProjectionOutcome)
    );
    const { runtime, adapter } = await consumer(project);
    await publish(upload('evt_drain'));
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(1);
    const stopped = runtime.dispose();
    await expect
      .poll(() => Effect.runPromise(adapter.check()), { timeout: 10000, interval: 20 })
      .toBe(false);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await stopped;
    await acknowledged();
  });

  it('bounds shutdown of blocked delivery and leaves unfinished work available for redelivery', async () => {
    const project = new ControlledProjection();
    let interrupted = false;
    project.nextEffect = Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        })
      )
    );
    const { runtime, adapter } = await consumer(project, { shutdownTimeoutMs: 30 });
    await publish(upload('evt_interrupted'));
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(1);
    await runtime.dispose();
    expect(interrupted).toBe(true);
    expect(await Effect.runPromise(adapter.check())).toBe(false);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect(
      (await manager.consumers.info('WALLPAPER', 'gateway-wallpaper-uploaded')).num_ack_pending
    ).toBe(1);
    await consumer(project);
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(2);
    await acknowledged();
    expect(project.changes.map((change) => change.occurrence.id)).toEqual([
      'evt_interrupted',
      'evt_interrupted',
    ]);
  });

  it('acknowledges completed and intentionally ignored deliveries after the port finishes', async () => {
    const project = new ControlledProjection();
    project.outcomes = [{ _tag: 'Completed' }, { _tag: 'Ignored' }];
    await consumer(project);
    await publish(upload('evt_completed'));
    await publish(upload('evt_ignored'));
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(2);
    await acknowledged();
    expect(project.changes.map((change) => change.occurrence.id)).toEqual([
      'evt_completed',
      'evt_ignored',
    ]);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('GATEWAY_QUARANTINE')).state.messages).toBe(0);
  });

  it('retries transient application outcomes without changing event identity', async () => {
    const project = new ControlledProjection();
    project.outcomes = [
      new ProjectionUnavailable({ cause: new Error('store unavailable') }),
      { _tag: 'Completed' },
    ];
    await consumer(project);
    await publish(upload('evt_retry'));
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(2);
    await acknowledged();
    expect(project.changes.map((change) => change.occurrence.id)).toEqual([
      'evt_retry',
      'evt_retry',
    ]);
  });

  it('quarantines exhausted retries durably before acknowledging', async () => {
    const project = new ControlledProjection();
    project.outcomes = Array.from(
      { length: 4 },
      () => new ProjectionUnavailable({ cause: new Error('store unavailable') })
    );
    await consumer(project);
    const original = upload('evt_exhausted');
    await publish(original);
    const quarantined = await quarantine();
    expect(quarantined).toMatchObject({
      specversion: '1.0',
      type: 'gateway.projection.quarantined',
      data: {
        subject: 'wallpaper.uploaded',
        original: Buffer.from(original).toString('base64'),
        consumer: 'gateway-wallpaper-uploaded',
        outcome: 'Exhausted',
      },
    });
    expect(project.changes).toHaveLength(4);
    await acknowledged();
  });

  it('quarantines structurally invalid input without calling the application', async () => {
    const project = new ControlledProjection();
    await consumer(project);
    await publish('{invalid json');
    expect(await quarantine()).toMatchObject({ data: { outcome: 'Invalid' } });
    expect(project.changes).toEqual([]);
    await acknowledged();
  });

  it('quarantines permanent application rejections without retrying', async () => {
    const project = new ControlledProjection();
    project.outcomes = [{ _tag: 'Rejected', reason: 'invalid-projection' }];
    await consumer(project);
    await publish(upload('evt_rejected'));
    expect(await quarantine()).toMatchObject({ data: { outcome: 'Rejected' } });
    expect(project.changes).toHaveLength(1);
    await acknowledged();
  });

  it('keeps responsibility with the broker when an unexpected defect occurs', async () => {
    const project = new ControlledProjection();
    project.defectNext = true;
    await consumer(project);
    await publish(upload('evt_defect'));
    await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(2);
    await acknowledged();
  });

  it('retries an unavailable quarantine and only acknowledges after its durable recovery', async () => {
    const project = new ControlledProjection();
    await consumer(project);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.streams.delete('GATEWAY_QUARANTINE');
    await publish('{invalid json');
    await expect
      .poll(
        async () =>
          (await manager.consumers.info('WALLPAPER', 'gateway-wallpaper-uploaded')).num_redelivered,
        { timeout: 10000, interval: 20 }
      )
      .toBeGreaterThan(0);
    await manager.streams.add({
      name: 'GATEWAY_QUARANTINE',
      subjects: ['gateway.quarantine'],
      storage: StorageType.File,
      discard: DiscardPolicy.New,
    });
    expect(await quarantine()).toMatchObject({ data: { outcome: 'Invalid' } });
    await acknowledged();
  });

  it('closes partially started consumers when a required stream is missing', async () => {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.streams.delete('PROFILE');
    try {
      await expect(consumer(new ControlledProjection())).rejects.toMatchObject({
        _tag: 'NatsProjectionStartupError',
      });
    } finally {
      await manager.streams.add({ name: 'PROFILE', subjects: ['profile.>'] });
    }
  });

  it('fails startup with a typed error when the broker is unreachable', async () => {
    await expect(
      consumer(new ControlledProjection(), { url: 'nats://127.0.0.1:1' })
    ).rejects.toMatchObject({ _tag: 'NatsProjectionStartupError' });
  });
});
