import { createHash, randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import {
  DiscardPolicy,
  headers,
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

function identity(message: JsMsg) {
  const info = message.info;
  return createHash('sha256')
    .update(
      JSON.stringify([
        info.domain,
        info.account_hash,
        info.stream,
        info.consumer,
        info.streamSequence,
        info.timestampNanos,
      ])
    )
    .update(message.data)
    .digest('hex');
}

function metadata(message: JsMsg, reason: string, id: string, type: string): MsgHdrs {
  const value = headers();
  value.set('ce-specversion', '1.0');
  value.set('ce-source', 'https://wallpaperdb/media');
  value.set('ce-id', id);
  value.set('ce-type', type);
  value.set('ce-time', new Date(message.info.timestampNanos / 1_000_000).toISOString());
  value.set('ce-reason', reason);
  value.set('ce-originalsubject', message.subject);
  value.set('ce-consumer', message.info.consumer);
  // Include headers added by JetStream before measuring the complete wire payload.
  value.set('Nats-Msg-Id', id);
  value.set('Nats-Expected-Stream', stream);
  for (const key of ['traceparent', 'tracestate']) {
    const traceValue = message.headers?.get(key);
    if (traceValue && traceValue.length <= 512) value.set(key, traceValue);
  }
  return value;
}

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
    if (
      stored &&
      stored.header.get('ce-id') === value.get('ce-id') &&
      Buffer.from(stored.data).equals(data)
    )
      return ack;
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

function chunkMetadata(
  message: JsMsg,
  reason: string,
  id: string,
  index: number,
  count: number,
  size: number
) {
  const value = metadata(
    message,
    reason,
    `${id}:${size}:${index}`,
    'media.upload.quarantine-chunk'
  );
  value.set('ce-quarantineid', id);
  value.set('ce-chunkindex', String(index));
  value.set('ce-chunkcount', String(count));
  return value;
}
const cannotFit = () =>
  Effect.fail(
    new BrokerFailure({
      operation: 'quarantine-capacity',
      cause: new Error('Quarantine message limit cannot accommodate its durable envelope'),
    })
  ).pipe(
    Effect.tapError((error) =>
      Effect.logError('Quarantine capacity rejected', { cause: error.cause })
    )
  );

/** Store chunks first and a manifest last; callers acknowledge only after every PubAck. */
export const quarantine = Effect.fn('media.quarantine.publish')(function* (
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
  const id = identity(message);
  const single = metadata(message, reason, id, 'media.upload.quarantined');
  if (message.data.byteLength + Buffer.byteLength(single.toString()) <= limit) {
    yield* publish(service, message.data, single);
    return;
  }
  // Reserve a conservative header bound using the maximum possible index/count/size digits.
  const bound = message.data.byteLength;
  const overhead = Buffer.byteLength(
    chunkMetadata(message, reason, id, bound, bound, bound).toString()
  );
  const size = Math.min(128 * 1024, limit - overhead);
  if (size <= 0) return yield* cannotFit();
  const count = Math.ceil(message.data.byteLength / size);
  if (count > 1024) return yield* cannotFit();
  const digest = createHash('sha256').update(message.data).digest('hex');
  const encodeManifest = (sequences: readonly number[]) =>
    new TextEncoder().encode(
      JSON.stringify({
        quarantineId: id,
        chunkCount: count,
        chunkSize: size,
        totalBytes: message.data.byteLength,
        sha256: digest,
        sequences,
      })
    );
  const manifestHeaders = metadata(
    message,
    reason,
    `${id}:manifest:${size}`,
    'media.upload.quarantine-manifest'
  );
  // Check the largest sequence references before accepting any partial durable handoff.
  const envelopeBound = encodeManifest(
    Array.from({ length: count }, () => Number.MAX_SAFE_INTEGER)
  );
  if (envelopeBound.byteLength + Buffer.byteLength(manifestHeaders.toString()) > limit)
    return yield* cannotFit();
  const sequences: number[] = [];
  for (let index = 0; index < count; index++) {
    const ack = yield* publish(
      service,
      message.data.subarray(index * size, (index + 1) * size),
      chunkMetadata(message, reason, id, index, count, size)
    );
    sequences.push(ack.seq);
  }
  const manifest = encodeManifest(sequences);
  yield* publish(service, manifest, manifestHeaders);
});
