import { Effect, Option, Schema } from 'effect';
import type { JetStreamManager, NatsConnection, StreamInfo } from 'nats';
import { StartupDiagnostic } from '../../startup-diagnostics.js';

const sourceMessageBytes = 64 * 1024;
export const quarantineMessageBytes = 256 * 1024;
const certificateKey = 'wallpaperdb.gateway.quarantine-budget';
const decodeCertificate = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(2),
      created: Schema.String,
      maxMessageBytes: Schema.Int,
      auditedThrough: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    })
  )
);
const decodeRetained = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({
        message: Schema.Struct({
          seq: Schema.Int,
          data: Schema.optionalKey(Schema.Uint8ArrayFromBase64),
          hdrs: Schema.optionalKey(Schema.Uint8ArrayFromBase64),
        }),
      }),
      Schema.Struct({ error: Schema.Struct({ code: Schema.Int, description: Schema.String }) }),
    ])
  ),
  { reportInput: false }
);

class MessageBudgetError extends Schema.TaggedError<MessageBudgetError>()('MessageBudgetError', {
  message: Schema.String,
  diagnostic: StartupDiagnostic,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const decodeStatus = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.Union([Schema.Int, Schema.NumberFromString]).check(
      Schema.isBetween({ minimum: 100, maximum: 599 })
    ),
  })
);

function statusDetails(error: unknown): { statusCode?: number } {
  const status = decodeStatus(error);
  return Option.isSome(status) ? { statusCode: status.value.code } : {};
}

function request<A>(
  message: string,
  context: { operation: string; stream: string; sequence?: number },
  run: () => Promise<A>
): Effect.Effect<A, MessageBudgetError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new MessageBudgetError({
        message,
        cause,
        diagnostic: {
          dependency: 'nats',
          code: 'NATS_REQUEST_FAILED',
          ...context,
          ...statusDetails(cause),
        },
      }),
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
  connection: NatsConnection,
  manager: JetStreamManager,
  snapshot: StreamInfo
) {
  const name = snapshot.config.name;
  const options = manager.getOptions();
  let sequence = snapshot.state.first_seq;
  while (sequence <= snapshot.state.last_seq) {
    // Read raw stored headers: the SDK's parsed headers discard original wire whitespace.
    const query = { seq: sequence, next_by_subj: '>' };
    const reply = yield* request(
      `Inspect retained ${name} sequence ${sequence}`,
      { operation: 'inspect-retained-message', stream: name, sequence },
      () =>
        connection.request(`${options.apiPrefix}.STREAM.MSG.GET.${name}`, JSON.stringify(query), {
          timeout: options.timeout ?? 5000,
        })
    );
    const response = yield* decodeRetained(reply.string()).pipe(
      Effect.mapError(
        (cause) =>
          new MessageBudgetError({
            message: `Decode retained ${name} sequence ${sequence}`,
            cause,
            diagnostic: {
              dependency: 'nats',
              operation: 'decode-retained-message',
              code: 'INVALID_RETAINED_MESSAGE_RESPONSE',
              stream: name,
              sequence,
            },
          })
      )
    );
    if ('error' in response) {
      if (response.error.code === 404) return;
      return yield* new MessageBudgetError({
        message: `Inspect retained ${name} sequence ${sequence}`,
        cause: response.error,
        diagnostic: {
          dependency: 'nats',
          operation: 'inspect-retained-message',
          code: 'NATS_REQUEST_FAILED',
          stream: name,
          sequence,
          ...statusDetails(response.error),
        },
      });
    }
    const message = response.message;
    if (message.seq > snapshot.state.last_seq) return;
    const payloadBytes = message.data?.byteLength ?? 0;
    const headerBytes = message.hdrs?.byteLength ?? 0;
    const bytes = payloadBytes + headerBytes;
    if (bytes > sourceMessageBytes) {
      return yield* new MessageBudgetError({
        message: `${name} sequence ${message.seq} retains ${bytes} bytes including headers, exceeding the ${sourceMessageBytes}-byte event budget. Export and resolve this retained message before restarting; it has not been deleted or acknowledged.`,
        diagnostic: {
          dependency: 'nats',
          operation: 'audit-retained-message',
          code: 'RETAINED_MESSAGE_TOO_LARGE',
          stream: name,
          sequence: message.seq,
          payloadBytes,
          headerBytes,
          actualBytes: bytes,
          limitBytes: sourceMessageBytes,
          remediation:
            'Export and resolve this retained message before restarting; it has not been deleted or acknowledged.',
        },
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
      diagnostic: {
        dependency: 'nats',
        operation: 'verify-message-budget',
        code: 'MESSAGE_BUDGET_CHANGED',
        stream: snapshot.config.name,
        remediation: 'Retry startup after completing stream recreation or message-limit changes.',
      },
    });
  }
});

const ensureSourceBudget = Effect.fn('catalogue.events.ensureSourceMessageBudget')(function* (
  connection: NatsConnection,
  manager: JetStreamManager,
  name: string
) {
  let snapshot = yield* request(
    `Inspect ${name} message budget`,
    { operation: 'inspect-message-budget', stream: name },
    () => manager.streams.info(name)
  );
  if (snapshot.config.max_msg_size <= 0 || snapshot.config.max_msg_size > sourceMessageBytes) {
    const metadata = { ...snapshot.config.metadata };
    delete metadata[certificateKey];
    snapshot = yield* request(
      `Limit ${name} messages to ${sourceMessageBytes} bytes`,
      { operation: 'limit-source-messages', stream: name },
      () => manager.streams.update(name, { max_msg_size: sourceMessageBytes, metadata })
    );
  }
  if (certified(snapshot)) return;
  yield* auditHistory(connection, manager, snapshot);
  const current = yield* request(
    `Recheck ${name} message budget`,
    { operation: 'recheck-message-budget', stream: name },
    () => manager.streams.info(name)
  );
  yield* verifyUnchanged(snapshot, current);
  const updated = yield* request(
    `Certify ${name} retained message budget`,
    { operation: 'certify-message-budget', stream: name },
    () =>
      manager.streams.update(name, {
        metadata: {
          ...current.config.metadata,
          [certificateKey]: JSON.stringify({
            version: 2,
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
  connection: NatsConnection,
  manager: JetStreamManager,
  maximumPayload: number | undefined,
  sourceStreams: ReadonlyArray<string>,
  quarantineStream: string
) {
  if (maximumPayload === undefined || maximumPayload < quarantineMessageBytes) {
    return yield* new MessageBudgetError({
      message: `NATS max_payload must allow at least ${quarantineMessageBytes} bytes for gateway quarantine messages.`,
      diagnostic: {
        dependency: 'nats',
        operation: 'check-broker-payload-limit',
        code:
          maximumPayload === undefined
            ? 'BROKER_PAYLOAD_LIMIT_UNAVAILABLE'
            : 'BROKER_PAYLOAD_TOO_SMALL',
        ...(maximumPayload === undefined ? {} : { actualBytes: maximumPayload }),
        minimumBytes: quarantineMessageBytes,
        remediation: 'Configure NATS max_payload to at least 262144 bytes and restart the gateway.',
      },
    });
  }
  const quarantine = yield* request(
    'Inspect quarantine message budget',
    { operation: 'inspect-quarantine-message-budget', stream: quarantineStream },
    () => manager.streams.info(quarantineStream)
  );
  if (
    quarantine.config.max_msg_size > 0 &&
    quarantine.config.max_msg_size < quarantineMessageBytes
  ) {
    return yield* new MessageBudgetError({
      message: `${quarantineStream} max_msg_size must allow at least ${quarantineMessageBytes} bytes for gateway quarantine messages.`,
      diagnostic: {
        dependency: 'nats',
        operation: 'check-quarantine-message-budget',
        code: 'QUARANTINE_MESSAGE_LIMIT_TOO_SMALL',
        stream: quarantineStream,
        actualBytes: quarantine.config.max_msg_size,
        minimumBytes: quarantineMessageBytes,
        remediation:
          'Configure the quarantine stream max_msg_size to at least 262144 bytes and restart the gateway.',
      },
    });
  }
  for (const stream of sourceStreams) yield* ensureSourceBudget(connection, manager, stream);
});
