import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { metrics } from '@opentelemetry/api';
import { DiscardPolicy, headers, StorageType } from 'nats';
import { GenericContainer, Wait } from 'testcontainers';
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

async function brokerProxy(url: string) {
  const target = new URL(url);
  const sockets = new Set<Socket>();
  let forwardsReplies = true;
  const server = createServer((socket) => {
    sockets.add(socket);
    const upstream = connect(Number(target.port), target.hostname);
    socket.pipe(upstream);
    upstream.on('data', (chunk) => {
      if (forwardsReplies) socket.write(chunk);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      upstream.destroy();
    });
    upstream.on('close', () => socket.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    url: `nats://127.0.0.1:${address.port}`,
    get connections() {
      return sockets.size;
    },
    stallReplies() {
      forwardsReplies = false;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
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

  async function quarantine(count = 1) {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('GATEWAY_QUARANTINE')).state.messages, {
        timeout: 10000,
        interval: 20,
      })
      .toBe(count);
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
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.consumers.update('WALLPAPER', 'gateway-wallpaper-uploaded', {
      max_ack_pending: 1,
    });
    const restarted = await consumer(new ControlledProjection());
    expect(await Effect.runPromise(restarted.adapter.check())).toBe(true);
    expect(
      (await manager.consumers.info('WALLPAPER', 'gateway-wallpaper-uploaded')).config
        .max_ack_pending
    ).toBe(1000);
  });

  it('allows replicas to project independently while each takes only its current delivery', async () => {
    const first = new ControlledProjection();
    const second = new ControlledProjection();
    const releaseFirst = Effect.runSync(Deferred.make<void>());
    const releaseSecond = Effect.runSync(Deferred.make<void>());
    first.nextEffect = Deferred.await(releaseFirst).pipe(
      Effect.as({ _tag: 'Completed' } satisfies ProjectionOutcome)
    );
    second.nextEffect = Deferred.await(releaseSecond).pipe(
      Effect.as({ _tag: 'Completed' } satisfies ProjectionOutcome)
    );
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const pending = async () => {
      const info = await manager.consumers.info('WALLPAPER', 'gateway-wallpaper-uploaded');
      return { waiting: info.num_pending, unacknowledged: info.num_ack_pending };
    };
    const laterIds = Array.from({ length: 16 }, (_, index) => `evt_parallel_${index}`);
    try {
      await consumer(first);
      await publish(upload('evt_held'));
      await expect.poll(() => first.changes.length, { timeout: 5000, interval: 20 }).toBe(1);
      await Promise.all(laterIds.map((id) => publish(upload(id))));
      await consumer(second);
      await expect.poll(() => second.changes.length, { timeout: 5000, interval: 20 }).toBe(1);
      await expect.poll(pending, { timeout: 5000, interval: 20 }).toEqual({
        waiting: 15,
        unacknowledged: 2,
      });
      expect(first.changes).toHaveLength(1);

      await Effect.runPromise(Deferred.succeed(releaseSecond, undefined));
      await expect.poll(() => second.changes.length, { timeout: 5000, interval: 20 }).toBe(16);
      await expect.poll(pending, { timeout: 5000, interval: 20 }).toEqual({
        waiting: 0,
        unacknowledged: 1,
      });
      expect(second.changes.map((change) => change.occurrence.id).sort()).toEqual(
        [...laterIds].sort()
      );
      expect(first.changes.map((change) => change.occurrence.id)).toEqual(['evt_held']);
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseFirst, undefined));
      await Effect.runPromise(Deferred.succeed(releaseSecond, undefined));
    }
    await acknowledged();
  });

  it('closes the broker socket within the shutdown deadline when drain cannot receive replies', async () => {
    const proxy = await brokerProxy(tester.nats.config.endpoints.fromHost);
    try {
      const { runtime, adapter } = await consumer(new ControlledProjection(), {
        url: proxy.url,
        shutdownTimeoutMs: 30,
      });
      expect(proxy.connections).toBe(1);
      proxy.stallReplies();
      const started = performance.now();
      await runtime.dispose();
      expect(performance.now() - started).toBeLessThan(1000);
      expect(await Effect.runPromise(adapter.check())).toBe(false);
      await expect.poll(() => proxy.connections, { timeout: 1000 }).toBe(0);
    } finally {
      await proxy.close();
    }
  });

  it('reports a terminated subscription as unhealthy and retains its work for a replacement consumer', async () => {
    const connection = await tester.nats.getConnection();
    const rejection = connection.subscribe(
      '$JS.API.CONSUMER.MSG.NEXT.WALLPAPER.gateway-wallpaper-uploaded',
      {
        callback: (error, message) => {
          if (!error) message.respond(undefined, { headers: headers(400, 'Bad Request') });
        },
      }
    );
    await connection.flush();
    const project = new ControlledProjection();
    try {
      const { runtime, adapter } = await consumer(project);
      await expect
        .poll(() => Effect.runPromise(adapter.check()), { timeout: 10000, interval: 20 })
        .toBe(false);
      await publish(upload('evt_terminated_subscription'));
      expect(project.changes).toEqual([]);
      await runtime.dispose();
      rejection.unsubscribe();
      await connection.flush();
      const restarted = await consumer(project);
      await expect.poll(() => project.changes.length, { timeout: 10000, interval: 20 }).toBe(1);
      await acknowledged();
      expect(project.changes[0]?.occurrence.id).toBe('evt_terminated_subscription');
      expect(await Effect.runPromise(restarted.adapter.check())).toBe(true);
    } finally {
      rejection.unsubscribe();
    }
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

  it('reserves quarantine capacity for the largest admitted arbitrary payload', async () => {
    const project = new ControlledProjection();
    await consumer(project);
    const js = await tester.nats.getJsClient();
    const original = Buffer.alloc(64 * 1024, 0xff);
    await js.publish('wallpaper.uploaded', original);
    expect((await quarantine()).data.original).toBe(original.toString('base64'));
    await acknowledged();
    expect(project.changes).toEqual([]);
    await expect(
      js.publish('wallpaper.uploaded', Buffer.alloc(64 * 1024 + 1, 0xff))
    ).rejects.toThrow(/message size exceeds maximum/i);
    await expect(js.publish('profile.created', Buffer.alloc(64 * 1024 + 1, 0xff))).rejects.toThrow(
      /message size exceeds maximum/i
    );
  });

  it('retains large event identities alongside the largest admitted event', async () => {
    const project = new ControlledProjection();
    project.outcomes = [{ _tag: 'Rejected', reason: 'invalid-projection' }];
    await consumer(project);
    const event = {
      specversion: '1.0',
      id: 'evt_large_metadata',
      source: 'wallpaperdb/test',
      type: 'wallpaper.uploaded',
      time: timestamp,
      correlationid: '',
      data: JSON.parse(upload('evt_large_metadata')),
    };
    event.correlationid = 'x'.repeat(64 * 1024 - Buffer.byteLength(JSON.stringify(event)));
    const original = JSON.stringify(event);
    expect(Buffer.byteLength(original)).toBe(64 * 1024);
    await publish(original);
    expect(await quarantine()).toMatchObject({
      causationid: event.id,
      correlationid: event.correlationid,
      data: { original: Buffer.from(original).toString('base64'), outcome: 'Rejected' },
    });
    await acknowledged();
  });

  it('quarantines malformed UTF-8 without expanding invalid event metadata', async () => {
    const project = new ControlledProjection();
    project.outcomes = [{ _tag: 'Rejected', reason: 'invalid-projection' }];
    await consumer(project);
    const marker = '_invalid_utf8_';
    const event = Buffer.from(
      JSON.stringify({
        specversion: '1.0',
        id: 'evt_invalid_utf8',
        source: 'wallpaperdb/test',
        type: 'wallpaper.uploaded',
        time: timestamp,
        correlationid: marker,
        data: JSON.parse(upload('evt_invalid_utf8')),
      })
    );
    const position = event.indexOf(marker);
    const prefix = event.subarray(0, position);
    const suffix = event.subarray(position + marker.length);
    const original = Buffer.concat([
      prefix,
      Buffer.alloc(64 * 1024 - prefix.length - suffix.length, 0xff),
      suffix,
    ]);
    await (await tester.nats.getJsClient()).publish('wallpaper.uploaded', original);
    expect(await quarantine()).toMatchObject({
      data: { original: original.toString('base64'), outcome: 'Invalid' },
    });
    expect(project.changes).toEqual([]);
    await acknowledged();
  });

  it('audits retained history once while preserving an existing stricter publisher limit', async () => {
    const connection = await tester.nats.getConnection();
    const manager = await connection.jetstreamManager();
    await manager.streams.update('WALLPAPER', { max_msg_size: 4096, metadata: { owner: 'test' } });
    await publish(upload('evt_existing_history'));
    const js = await tester.nats.getJsClient();
    const deleted = await js.publish('wallpaper.uploaded', upload('evt_deleted_history'));
    await publish(upload('evt_existing_later_history'));
    await manager.streams.deleteMessage('WALLPAPER', deleted.seq);
    let historyReads = 0;
    const inspection = connection.subscribe('$JS.API.STREAM.MSG.GET.WALLPAPER', {
      callback: () => {
        historyReads++;
      },
    });
    await connection.flush();
    try {
      const first = await consumer(new ControlledProjection());
      await acknowledged();
      await connection.flush();
      expect(historyReads).toBe(2);
      const initialReads = historyReads;
      expect((await manager.streams.info('WALLPAPER')).config).toMatchObject({
        max_msg_size: 4096,
        metadata: { owner: 'test' },
      });
      await first.runtime.dispose();
      const second = await consumer(new ControlledProjection());
      expect(await Effect.runPromise(second.adapter.check())).toBe(true);
      await connection.flush();
      expect(historyReads).toBe(initialReads);
    } finally {
      inspection.unsubscribe();
      await manager.streams.update('WALLPAPER', { max_msg_size: 64 * 1024 });
    }
  });

  it.each([
    { bytes: 64 * 1024, certificateVersion: undefined, accepted: true },
    { bytes: 64 * 1024, certificateVersion: 1, accepted: true },
    { bytes: 64 * 1024 + 1, certificateVersion: undefined, accepted: false },
    { bytes: 64 * 1024 + 1, certificateVersion: 1, accepted: false },
  ])('audits the complete retained message budget: $bytes bytes, certificate $certificateVersion', async ({
    bytes,
    certificateVersion,
    accepted,
  }) => {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.streams.update('WALLPAPER', { max_msg_size: -1, metadata: {} });
    const original = Buffer.alloc(8192, 0xff);
    const messageHeaders = headers();
    const headerOverhead = Buffer.byteLength('NATS/1.0\r\nX-Audit: \r\n\r\n');
    messageHeaders.set('X-Audit', 'x'.repeat(bytes - original.byteLength - headerOverhead));
    const published = await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      original,
      { headers: messageHeaders }
    );
    const snapshot = await manager.streams.info('WALLPAPER');
    await manager.streams.update('WALLPAPER', {
      max_msg_size: 64 * 1024,
      metadata:
        certificateVersion === undefined
          ? {}
          : {
              'wallpaperdb.gateway.quarantine-budget': JSON.stringify({
                version: certificateVersion,
                created: snapshot.created,
                maxMessageBytes: 64 * 1024,
                auditedThrough: snapshot.state.last_seq,
              }),
            },
    });
    const project = new ControlledProjection();
    if (accepted) {
      await consumer(project);
      expect(await quarantine()).toMatchObject({ data: { original: original.toString('base64') } });
      await acknowledged();
      expect(
        JSON.parse(
          (await manager.streams.info('WALLPAPER')).config.metadata?.[
            'wallpaperdb.gateway.quarantine-budget'
          ] ?? '{}'
        )
      ).toMatchObject({ version: 2 });
    } else {
      await expect(consumer(project)).rejects.toMatchObject({
        _tag: 'NatsProjectionStartupError',
        cause: {
          _tag: 'MessageBudgetError',
          message: expect.stringContaining(`retains ${bytes} bytes`),
        },
      });
      expect((await manager.streams.info('GATEWAY_QUARANTINE')).state.messages).toBe(0);
    }
    const retained = await manager.streams.getMessage('WALLPAPER', { seq: published.seq });
    expect(Buffer.from(retained.data).equals(original)).toBe(true);
    expect(retained.header.get('X-Audit')).toBe(messageHeaders.get('X-Audit'));
    expect(project.changes).toEqual([]);
  });

  it('counts original header whitespace when auditing historical messages', async () => {
    const connection = await tester.nats.getConnection();
    const manager = await connection.jetstreamManager();
    await manager.streams.update('WALLPAPER', { max_msg_size: -1, metadata: {} });
    const original = Buffer.alloc(8192, 0xff);
    const headerPrefix = 'NATS/1.0\r\nX-Audit: ';
    const headerSuffix = 'x\r\n\r\n';
    const wireHeaders = Buffer.from(
      headerPrefix +
        ' '.repeat(65537 - original.byteLength - Buffer.byteLength(headerPrefix + headerSuffix)) +
        headerSuffix
    );
    const url = new URL(tester.nats.config.endpoints.fromHost);
    const socket = connect(Number(url.port), url.hostname);
    try {
      await once(socket, 'connect');
      socket.write(
        Buffer.concat([
          Buffer.from(
            `CONNECT {"verbose":false,"headers":true}\r\nHPUB wallpaper.uploaded ${wireHeaders.byteLength} 65537\r\n`
          ),
          wireHeaders,
          original,
          Buffer.from('\r\n'),
        ])
      );
      await expect
        .poll(async () => (await manager.streams.info('WALLPAPER')).state.messages)
        .toBe(1);
    } finally {
      socket.destroy();
    }
    const snapshot = await manager.streams.update('WALLPAPER', { max_msg_size: 65536 });
    await expect(consumer(new ControlledProjection())).rejects.toMatchObject({
      _tag: 'NatsProjectionStartupError',
      cause: {
        _tag: 'MessageBudgetError',
        message: expect.stringContaining('retains 65537 bytes'),
      },
    });
    const retained = await manager.streams.getMessage('WALLPAPER', {
      seq: snapshot.state.last_seq,
    });
    expect(retained.header.get('X-Audit')).toBe('x');
    expect(Buffer.from(retained.data).equals(original)).toBe(true);
    const reply = await connection.request(
      '$JS.API.STREAM.MSG.GET.WALLPAPER',
      JSON.stringify({ seq: snapshot.state.last_seq })
    );
    expect(Buffer.from(JSON.parse(reply.string()).message.hdrs, 'base64').equals(wireHeaders)).toBe(
      true
    );
    expect((await manager.streams.info('GATEWAY_QUARANTINE')).state.messages).toBe(0);
  });

  it.each([
    false,
    true,
  ])('preserves oversized historical messages and refuses startup (recreated stream: %s)', async (recreated) => {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const first = await consumer(new ControlledProjection());
    await first.runtime.dispose();
    const { config } = await manager.streams.info('WALLPAPER');
    if (recreated) {
      await manager.streams.delete('WALLPAPER');
      await manager.streams.add({ ...config, max_msg_size: -1 });
    } else {
      await manager.streams.update('WALLPAPER', { max_msg_size: -1, metadata: {} });
    }
    const original = Buffer.alloc(800000, 0xff);
    const published = await (await tester.nats.getJsClient()).publish(
      'wallpaper.uploaded',
      original
    );
    await manager.streams.update('WALLPAPER', { max_msg_size: 64 * 1024 });
    await expect(consumer(new ControlledProjection())).rejects.toMatchObject({
      _tag: 'NatsProjectionStartupError',
      cause: {
        _tag: 'MessageBudgetError',
        message: expect.stringContaining(`WALLPAPER sequence ${published.seq}`),
      },
    });
    expect(
      Buffer.from(
        (await manager.streams.getMessage('WALLPAPER', { seq: published.seq })).data
      ).equals(original)
    ).toBe(true);
    expect((await manager.streams.info('GATEWAY_QUARANTINE')).state.messages).toBe(0);
  });

  it('rejects a quarantine stream whose message limit cannot retain admitted originals', async () => {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const first = await consumer(new ControlledProjection());
    await first.runtime.dispose();
    await manager.streams.update('GATEWAY_QUARANTINE', { max_msg_size: 64 * 1024 });
    try {
      await expect(consumer(new ControlledProjection())).rejects.toMatchObject({
        _tag: 'NatsProjectionStartupError',
        cause: {
          _tag: 'MessageBudgetError',
          message: expect.stringContaining('GATEWAY_QUARANTINE'),
        },
      });
    } finally {
      await manager.streams.update('GATEWAY_QUARANTINE', { max_msg_size: 256 * 1024 });
    }
  });

  it('rejects a broker payload limit that leaves insufficient quarantine capacity', async () => {
    const broker = await new GenericContainer('nats:2.10-alpine')
      .withCopyContentToContainer([
        {
          content: 'port:4222\nhttp_port:8222\nmax_payload:131072\njetstream {}\n',
          target: '/tmp/nats.conf',
        },
      ])
      .withCommand(['-c', '/tmp/nats.conf'])
      .withExposedPorts(4222, 8222)
      .withWaitStrategy(Wait.forHttp('/healthz', 8222).forStatusCode(200))
      .start();
    try {
      await expect(
        consumer(new ControlledProjection(), {
          url: `nats://127.0.0.1:${broker.getMappedPort(4222)}`,
        })
      ).rejects.toMatchObject({
        _tag: 'NatsProjectionStartupError',
        cause: { _tag: 'MessageBudgetError', message: expect.stringContaining('max_payload') },
      });
    } finally {
      await broker.stop();
    }
  });

  it.each([
    '{different invalid json',
    '{invalid json',
  ])('preserves a new quarantine occurrence after recreating its source stream: %s', async (replacement) => {
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    const { config } = await manager.streams.info('WALLPAPER');
    await manager.streams.delete('WALLPAPER');
    await manager.streams.add(config);
    const first = await consumer(new ControlledProjection());
    await publish('{invalid json');
    const original = await quarantine();
    await acknowledged();
    await first.runtime.dispose();

    await manager.streams.delete('WALLPAPER');
    await manager.streams.add(config);
    await consumer(new ControlledProjection());
    await publish(replacement);
    await acknowledged();

    const recreated = await quarantine(2);
    expect(recreated.id).not.toBe(original.id);
    expect(recreated.data.original).toBe(Buffer.from(replacement).toString('base64'));
  });

  it('reuses the quarantine occurrence when a recreated consumer replays retained input', async () => {
    const first = await consumer(new ControlledProjection());
    await publish('{invalid json');
    const original = await quarantine();
    await acknowledged();
    await first.runtime.dispose();

    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    await manager.consumers.delete('WALLPAPER', 'gateway-wallpaper-uploaded');
    await consumer(new ControlledProjection());
    await acknowledged();
    expect(await quarantine()).toEqual(original);
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
