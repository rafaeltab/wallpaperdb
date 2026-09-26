import { createHash, randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import {
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  headers,
  type JsMsg,
  type MsgHdrs,
} from 'nats';
import { MaintenanceFailure } from '../../maintenance/index.js';
import { broker, type EventsBroker } from './broker.js';

const stream = 'USER_QUARANTINE';
const subject = 'user.quarantine';
const maxBytes = 64 * 1024 * 1024;
const maxAge = 30 * 24 * 60 * 60 * 1_000_000_000;
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));
const failed = (operation: string, message: string) =>
  Effect.fail(new MaintenanceFailure({ operation, cause: new Error(message) }));

export const ensureQuarantine = Effect.fn('profiles.quarantine.initialize')(function* (
  service: EventsBroker
) {
  const info = yield* broker('inspect-quarantine', () => service.manager.streams.info(stream)).pipe(
    Effect.catchIf(
      (failure) => notFound(failure.cause),
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
  const config = info.config;
  if (
    config.storage !== StorageType.File ||
    config.retention !== RetentionPolicy.Limits ||
    config.discard !== DiscardPolicy.New ||
    config.max_bytes <= 0 ||
    config.max_bytes > maxBytes ||
    config.max_age !== maxAge ||
    !config.subjects.includes(subject) ||
    (config.max_msgs_per_subject > 0 && config.discard_new_per_subject !== true)
  )
    return yield* failed(
      'quarantine-configuration',
      'Quarantine requires file storage, limits retention, discard-new, at most 64 MiB, exactly 30 days and no per-subject eviction'
    );
});

function envelope(id: string, type: string, time: string): MsgHdrs {
  const metadata = headers();
  for (const [key, value] of Object.entries({
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/user',
    'ce-id': id,
    'ce-type': type,
    'ce-time': time,
    'Nats-Msg-Id': id,
    'Nats-Expected-Stream': stream,
  }))
    metadata.set(key, value);
  return metadata;
}
const publish = Effect.fn('profiles.quarantine.store')(function* (
  service: EventsBroker,
  data: Uint8Array,
  metadata: MsgHdrs
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ack = yield* broker('store-quarantine', () =>
      service.client.publish(subject, data, {
        headers: metadata,
        msgID: metadata.get('Nats-Msg-Id'),
        expect: { streamName: stream },
        timeout: 5000,
      })
    );
    if (!ack.duplicate) return ack.seq;
    const stored = yield* broker('verify-quarantine', () =>
      service.manager.streams.getMessage(stream, { seq: ack.seq })
    ).pipe(
      Effect.catchIf(
        (failure) => notFound(failure.cause),
        () => Effect.succeed(undefined)
      )
    );
    if (
      stored &&
      stored.header.get('ce-id') === metadata.get('ce-id') &&
      Buffer.from(stored.data).equals(data)
    )
      return ack.seq;
    // A purge can remove evidence while the broker still remembers its message ID.
    metadata.set('Nats-Msg-Id', createHash('sha256').update(randomUUID()).digest('hex'));
  }
  return yield* failed('quarantine-recovery', 'Could not verify stored quarantine evidence');
});

/** Original bytes and envelope remain reconstructable. All records need PubAck before input acknowledgement. */
export const quarantine = Effect.fn('profiles.quarantine.accept')(function* (
  service: EventsBroker,
  message: JsMsg,
  reason: 'invalid' | 'exhausted'
) {
  const originalHeaders: Record<string, string[]> = {};
  for (const key of message.headers?.keys() ?? []) {
    if (
      key.toLowerCase().startsWith('ce-') ||
      ['traceparent', 'tracestate', 'content-type'].includes(key.toLowerCase())
    )
      originalHeaders[key] = message.headers?.values(key) ?? [];
  }
  const info = message.info;
  const occurrence = JSON.stringify([
    info.domain,
    info.account_hash,
    info.stream,
    info.consumer,
    info.streamSequence,
    info.timestampNanos,
  ]);
  const id = createHash('sha256').update(occurrence).update(message.data).digest('hex');
  const time = new Date(info.timestampNanos / 1_000_000).toISOString();
  const encoded = Buffer.from(
    JSON.stringify({
      id,
      reason,
      subject: message.subject,
      headers: originalHeaders,
      data: Buffer.from(message.data).toString('base64'),
      stream: info.stream,
      sequence: info.streamSequence,
      consumer: info.consumer,
    })
  );
  const state = yield* broker('inspect-quarantine-capacity', () =>
    service.manager.streams.info(stream)
  );
  const serverLimit = service.connection.info?.max_payload ?? 0;
  const limit =
    state.config.max_msg_size > 0 ? Math.min(serverLimit, state.config.max_msg_size) : serverLimit;
  const metadata = envelope(id, 'user.ownership.quarantined', time);
  if (encoded.byteLength + Buffer.byteLength(metadata.toString()) <= limit) {
    yield* publish(service, encoded, metadata);
    return;
  }
  const chunkHeaders = (index: number, size: number) =>
    envelope(`${id}:${size}:${index}`, 'user.ownership.quarantine-chunk', time);
  const size = Math.min(
    128 * 1024,
    limit - Buffer.byteLength(chunkHeaders(encoded.length, encoded.length).toString())
  );
  if (size <= 0)
    return yield* failed(
      'quarantine-capacity',
      'Message capacity is too small for quarantine metadata'
    );
  const count = Math.ceil(encoded.length / size);
  if (count > 1024)
    return yield* failed('quarantine-capacity', 'Message requires too many quarantine chunks');
  const manifestHeaders = envelope(
    `${id}:manifest:${size}`,
    'user.ownership.quarantine-manifest',
    time
  );
  const manifest = (sequences: number[]) =>
    Buffer.from(
      JSON.stringify({
        id,
        encoding: 'json-base64',
        reason,
        size,
        bytes: encoded.length,
        sha256: createHash('sha256').update(encoded).digest('hex'),
        sequences,
      })
    );
  if (
    manifest(Array.from({ length: count }, () => Number.MAX_SAFE_INTEGER)).length +
      Buffer.byteLength(manifestHeaders.toString()) >
    limit
  )
    return yield* failed(
      'quarantine-capacity',
      'Message capacity is too small for quarantine manifest'
    );
  const sequences: number[] = [];
  for (let index = 0; index < count; index++)
    sequences.push(
      yield* publish(
        service,
        encoded.subarray(index * size, (index + 1) * size),
        chunkHeaders(index, size)
      )
    );
  yield* publish(service, manifest(sequences), manifestHeaders);
});
