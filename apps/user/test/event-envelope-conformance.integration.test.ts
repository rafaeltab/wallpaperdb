import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { uploadEnvelopeConformance } from '@wallpaperdb/test-utils/event-contracts';
import { Effect, Layer, Logger, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  brokerLayer,
  ConsumerHealth,
  ownershipConsumerLayer,
} from '../src/adapters/events/index.js';
import { Maintenance, type WallpaperOwnership } from '../src/maintenance/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((nats) => nats.withJetstream()).withStream('WALLPAPER');
let runtime: ManagedRuntime.ManagedRuntime<ConsumerHealth, unknown>;
const accepted: WallpaperOwnership[] = [];
const logs: unknown[] = [];
beforeAll(async () => {
  await tester.setup();
  const options = {
    url: tester.nats.config.endpoints.fromHost,
    stream: 'WALLPAPER',
    serviceName: 'user-envelope-conformance',
  };
  const unused = () => Effect.die('Unexpected maintenance task');
  runtime = ManagedRuntime.make(
    ownershipConsumerLayer(options).pipe(
      Layer.provide(brokerLayer(options)),
      Layer.provide(
        Layer.succeed(Maintenance, {
          publishPending: unused,
          cleanupEvents: unused,
          expireAliases: unused,
          recordWallpaperOwnership: (ownership) =>
            Effect.sync(() => {
              accepted.push(ownership);
            }),
        })
      ),
      Layer.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            logs.push(message);
          }),
        ])
      )
    )
  );
  await runtime.runPromise(ConsumerHealth);
});
afterAll(async () => {
  await runtime?.dispose();
  await tester.destroy();
});
it.each(uploadEnvelopeConformance())('$name', async ({
  payload,
  metadata,
  accepted: valid,
  expected,
}) => {
  const connection = await tester.nats.getConnection();
  const manager = await connection.jetstreamManager();
  const prior = accepted.length;
  const priorLogs = logs.length;
  const priorQuarantine = (await manager.streams.info('USER_QUARANTINE')).state.messages;
  const ack = await connection
    .jetstream()
    .publish('wallpaper.uploaded', payload, { headers: metadata });
  await expect
    .poll(
      async () =>
        (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).ack_floor.stream_seq
    )
    .toBe(ack.seq);
  expect(accepted.length - prior).toBe(valid ? 1 : 0);
  expect((await manager.streams.info('USER_QUARANTINE')).state.messages - priorQuarantine).toBe(
    valid ? 0 : 1
  );
  if (expected) {
    expect(accepted.at(-1)).toEqual({
      wallpaperId: 'contract-wallpaper',
      profileId: 'contract-profile',
    });
    expect(logs.slice(priorLogs)).toContainEqual(
      expect.arrayContaining([
        expect.objectContaining({
          'event.id': expected.id,
          'event.source': expected.source,
          ...(expected.correlationId ? { 'event.correlation_id': expected.correlationId } : {}),
          ...(expected.causationId ? { 'event.causation_id': expected.causationId } : {}),
        }),
      ])
    );
  }
});
