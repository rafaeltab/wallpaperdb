import { Effect, Schema } from 'effect';
import { DiscardPolicy, RetentionPolicy, StorageType, type StreamConfig } from 'nats';
import { ExtractionUnavailable } from '../../extraction/index.js';
import { broker, type NatsBroker } from './broker.js';

const stream = 'COLOR_EXTRACTOR_QUARANTINE';
const subject = 'color-extractor.quarantine';
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
export const ensureQuarantine = Effect.fn('colors.quarantine.initialize')(function* (
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
      new ExtractionUnavailable({
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
