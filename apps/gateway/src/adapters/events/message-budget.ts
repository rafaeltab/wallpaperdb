import { Effect, Option, Schema } from 'effect';
import type { JetStreamManager, StreamInfo } from 'nats';

const sourceMessageBytes = 64 * 1024;
export const quarantineMessageBytes = 256 * 1024;
const certificateKey = 'wallpaperdb.gateway.quarantine-budget';
const decodeCertificate = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      created: Schema.String,
      maxMessageBytes: Schema.Int,
      auditedThrough: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    })
  )
);
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));

class MessageBudgetError extends Schema.TaggedError<MessageBudgetError>()('MessageBudgetError', {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

function request<A>(message: string, run: () => Promise<A>): Effect.Effect<A, MessageBudgetError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new MessageBudgetError({ message, cause }),
  });
}

function certified(info: StreamInfo): boolean {
  const certificate = decodeCertificate(info.config.metadata?.[certificateKey]);
  return (
    Option.isSome(certificate) &&
    certificate.value.created === info.created &&
    certificate.value.maxMessageBytes === info.config.max_msg_size &&
    certificate.value.auditedThrough <= info.state.last_seq
  );
}

const auditHistory = Effect.fn('catalogue.events.auditMessageBudget')(function* (
  manager: JetStreamManager,
  snapshot: StreamInfo
) {
  const name = snapshot.config.name;
  let sequence = snapshot.state.first_seq;
  while (sequence <= snapshot.state.last_seq) {
    // The stream-get API accepts subject iteration; the SDK forwards this request unchanged.
    const query = { seq: sequence, next_by_subj: '>' };
    const message = yield* request(`Inspect retained ${name} sequence ${sequence}`, () =>
      manager.streams.getMessage(name, query)
    ).pipe(
      Effect.catchIf(
        (error) => notFound(error.cause),
        () => Effect.succeed(undefined)
      )
    );
    if (!message || message.seq > snapshot.state.last_seq) return;
    if (message.data.byteLength > sourceMessageBytes) {
      return yield* new MessageBudgetError({
        message: `${name} sequence ${message.seq} retains ${message.data.byteLength} bytes, exceeding the ${sourceMessageBytes}-byte event budget. Export and resolve this retained message before restarting; it has not been deleted or acknowledged.`,
      });
    }
    sequence = message.seq + 1;
  }
});

const verifyUnchanged = Effect.fnUntraced(function* (snapshot: StreamInfo, current: StreamInfo) {
  if (
    snapshot.created !== current.created ||
    snapshot.config.max_msg_size !== current.config.max_msg_size
  ) {
    return yield* new MessageBudgetError({
      message: `${snapshot.config.name} was recreated or its message limit changed during the quarantine-budget audit; retry startup.`,
    });
  }
});

const ensureSourceBudget = Effect.fn('catalogue.events.ensureSourceMessageBudget')(function* (
  manager: JetStreamManager,
  name: string
) {
  let snapshot = yield* request(`Inspect ${name} message budget`, () => manager.streams.info(name));
  if (snapshot.config.max_msg_size <= 0 || snapshot.config.max_msg_size > sourceMessageBytes) {
    const metadata = { ...snapshot.config.metadata };
    delete metadata[certificateKey];
    snapshot = yield* request(`Limit ${name} messages to ${sourceMessageBytes} bytes`, () =>
      manager.streams.update(name, { max_msg_size: sourceMessageBytes, metadata })
    );
  }
  if (certified(snapshot)) return;
  yield* auditHistory(manager, snapshot);
  const current = yield* request(`Recheck ${name} message budget`, () =>
    manager.streams.info(name)
  );
  yield* verifyUnchanged(snapshot, current);
  const updated = yield* request(`Certify ${name} retained message budget`, () =>
    manager.streams.update(name, {
      metadata: {
        ...current.config.metadata,
        [certificateKey]: JSON.stringify({
          version: 1,
          created: snapshot.created,
          maxMessageBytes: snapshot.config.max_msg_size,
          auditedThrough: snapshot.state.last_seq,
        }),
      },
    })
  );
  yield* verifyUnchanged(snapshot, updated);
});

export const ensureMessageBudgets = Effect.fn('catalogue.events.ensureMessageBudgets')(function* (
  manager: JetStreamManager,
  maximumPayload: number | undefined,
  sourceStreams: ReadonlyArray<string>,
  quarantineStream: string
) {
  if (maximumPayload === undefined || maximumPayload < quarantineMessageBytes) {
    return yield* new MessageBudgetError({
      message: `NATS max_payload must allow at least ${quarantineMessageBytes} bytes for gateway quarantine messages.`,
    });
  }
  const quarantine = yield* request('Inspect quarantine message budget', () =>
    manager.streams.info(quarantineStream)
  );
  if (
    quarantine.config.max_msg_size > 0 &&
    quarantine.config.max_msg_size < quarantineMessageBytes
  ) {
    return yield* new MessageBudgetError({
      message: `${quarantineStream} max_msg_size must allow at least ${quarantineMessageBytes} bytes for gateway quarantine messages.`,
    });
  }
  for (const stream of sourceStreams) yield* ensureSourceBudget(manager, stream);
});
