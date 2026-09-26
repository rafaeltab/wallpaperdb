import {
  quarantineRecordMatches,
  planQuarantine,
  quarantineIdentity,
} from '@wallpaperdb/core/quarantine';
import type { ProjectionInput } from '../../catalog/index.js';
import { inputAttributes } from './telemetry.js';
import { createHash, randomUUID } from 'node:crypto';
import { Clock, Effect, Exit, Schema } from 'effect';
import {
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type JsMsg,
  type MsgHdrs,
  type StreamConfig,
} from 'nats';
import { broker, BrokerFailure, type NatsBroker } from './broker.js';

const stream = 'MEDIA_QUARANTINE';
const subject = 'media.quarantine';
const maxBytes = 1024 * 1024 * 1024;
const maxAge = 30 * 24 * 60 * 60 * 1_000_000_000;
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));

function safeConfiguration(config: StreamConfig) {
  return (
    config.retention === RetentionPolicy.Limits &&
    config.storage === StorageType.File &&
    config.discard === DiscardPolicy.New &&
    config.max_bytes > 0 &&
    config.max_bytes <= maxBytes &&
    config.max_age === maxAge &&
    (config.max_msgs_per_subject <= 0 || config.discard_new_per_subject === true) &&
    config.subjects.includes(subject)
  );
}

/** Existing streams must be explicitly migrated by their operator; startup never rewrites retention. */
export const ensureQuarantine = Effect.fn('media.quarantine.initialize')(function* (
  service: NatsBroker
) {
  const info = yield* broker('inspect-quarantine', () => service.manager.streams.info(stream)).pipe(
    Effect.catchIf(
      (error) => notFound(error.cause),
      () =>
        broker('create-quarantine', () =>
          service.manager.streams.add({
            name: stream,
            subjects: [subject],
            storage: StorageType.File,
            retention: RetentionPolicy.Limits,
            discard: DiscardPolicy.New,
            max_bytes: maxBytes,
            max_age: maxAge,
          })
        )
    )
  );
  if (!safeConfiguration(info.config))
    return yield* Effect.fail(
      new BrokerFailure({
        operation: 'configure-quarantine',
        cause: new Error(
          'Quarantine requires file storage, limits retention, discard-new, at most 1 GiB, and exactly 30 days, and no per-subject eviction; migrate existing streams explicitly'
        ),
      })
    ).pipe(
      Effect.tapError((error) =>
        Effect.logError('Quarantine configuration rejected', { cause: error.cause })
      )
    );
});

const publish = Effect.fn('media.quarantine.store')(function* (
  service: NatsBroker,
  data: Uint8Array,
  value: MsgHdrs
) {
  // A purge removes records but can leave JetStream's deduplication entries intact.
  // Verify duplicate references, including manifests whose repaired chunk sequences changed.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ack = yield* broker('quarantine-upload', () =>
      service.client.publish(subject, data, {
        headers: value,
        msgID: value.get('Nats-Msg-Id'),
        expect: { streamName: stream },
        timeout: 5000,
      })
    );
    if (!ack.duplicate) return ack;
    const stored = yield* broker('verify-quarantine-record', () =>
      service.manager.streams.getMessage(stream, { seq: ack.seq })
    ).pipe(
      Effect.catchIf(
        (error) => notFound(error.cause),
        () => Effect.succeed(undefined)
      )
    );
    if (stored && quarantineRecordMatches({ data, headers: value }, stored)) return ack;
    // This is a replacement storage operation, not a new event occurrence. A fixed-size
    // fresh broker ID fits the measured envelope and avoids following obsolete repair IDs.
    value.set('Nats-Msg-Id', createHash('sha256').update(randomUUID()).digest('hex'));
  }
  return yield* Effect.fail(
    new BrokerFailure({
      operation: 'quarantine-recovery',
      cause: new Error('Quarantine references could not be repaired within three publications'),
    })
  ).pipe(
    Effect.tapError((error) =>
      Effect.logError('Quarantine recovery failed', { cause: error.cause })
    )
  );
});

/** Store chunks first and a manifest last; callers acknowledge only after every PubAck. */
const storeQuarantine = Effect.fn('media.quarantine.store-records')(function* (
  service: NatsBroker,
  message: JsMsg,
  reason: string
) {
  const info = yield* broker('inspect-quarantine-capacity', () =>
    service.manager.streams.info(stream)
  );
  const brokerLimit = service.connection.info?.max_payload ?? 0;
  const limit =
    info.config.max_msg_size > 0 ? Math.min(brokerLimit, info.config.max_msg_size) : brokerLimit;
  const plan = yield* Effect.try({
    try: () =>
      planQuarantine(
        { stream, source: 'https://wallpaperdb/media', eventTypePrefix: 'media.upload' },
        message,
        reason,
        limit
      ),
    catch: (cause) => new BrokerFailure({ operation: 'quarantine-capacity', cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Quarantine capacity rejected', { cause: error.cause })
    )
  );
  const sequences: number[] = [];
  for (const record of plan.records) {
    const ack = yield* publish(service, record.data, record.headers);
    sequences.push(ack.seq);
  }
  if (plan.manifest) {
    const manifest = plan.manifest(sequences);
    yield* publish(service, manifest.data, manifest.headers);
  }
});

export const quarantine = Effect.fn('media.quarantine.publish')(function* (
  service: NatsBroker,
  message: JsMsg,
  reason: string,
  input?: ProjectionInput
) {
  const started = yield* Clock.currentTimeMillis;
  const attributes = {
    ...inputAttributes(input),
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': message.info.deliveryCount,
    'quarantine.id': quarantineIdentity(message),
    'quarantine.reason': reason,
  };
  yield* Effect.annotateCurrentSpan(attributes);
  return yield* storeQuarantine(service, message, reason).pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const duration = (yield* Clock.currentTimeMillis) - started;
        const outcome = Exit.isSuccess(exit) ? 'quarantined' : 'failed';
        yield* Effect.annotateCurrentSpan({
          'event.outcome': outcome,
          'event.duration_ms': duration,
        });
        yield* Effect.logInfo('Media quarantine handoff finished', {
          'event.outcome': outcome,
          'event.duration_ms': duration,
        });
      })
    ),
    Effect.annotateLogs(attributes)
  );
});
