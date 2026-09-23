import { Option, Schema } from 'effect';

const identifier = Schema.String.check(Schema.isMaxLength(256));
const bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Adapters construct this allowlist; raw vendor messages and metadata stay in opaque causes. */
export const StartupDiagnostic = Schema.Struct({
  dependency: Schema.Literals(['opensearch', 'nats', 'http', 'gateway']),
  operation: identifier,
  code: identifier,
  index: Schema.optionalKey(identifier),
  stream: Schema.optionalKey(identifier),
  sequence: Schema.optionalKey(bytes),
  actualBytes: Schema.optionalKey(bytes),
  limitBytes: Schema.optionalKey(bytes),
  minimumBytes: Schema.optionalKey(bytes),
  payloadBytes: Schema.optionalKey(bytes),
  headerBytes: Schema.optionalKey(bytes),
  statusCode: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
  ),
  port: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 }))),
  remediation: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
});

const decodeFailure = Schema.decodeUnknownOption(
  Schema.Struct({
    _tag: Schema.Literals([
      'GatewayBootstrapError',
      'GatewayStartupError',
      'GatewayShutdownError',
      'OpenSearchStartupError',
      'NatsProjectionStartupError',
      'MessageBudgetError',
      'BrokerError',
    ]),
    diagnostic: Schema.optionalKey(StartupDiagnostic),
    cause: Schema.optionalKey(Schema.Unknown),
  })
);
const decodeCode = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.Literals([
      'EADDRINUSE',
      'EADDRNOTAVAIL',
      'EACCES',
      'EPERM',
      'EMFILE',
      'ENFILE',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ERR_MODULE_NOT_FOUND',
      'MODULE_NOT_FOUND',
      'ERR_DLOPEN_FAILED',
    ]),
  })
);

export function nativeFailureCode(error: unknown): string {
  const decoded = decodeCode(error);
  return Option.isSome(decoded) ? decoded.value.code : 'UnknownError';
}

/** Unwrap only owned failures and aggregated cleanup failures, never arbitrary vendor objects. */
export function startupDiagnostics(error: unknown): Array<typeof StartupDiagnostic.Type> {
  const pending = [error];
  const seen = new Set<unknown>();
  const diagnostics: Array<typeof StartupDiagnostic.Type> = [];
  for (let inspected = 0; pending.length > 0 && inspected < 16; inspected++) {
    const current = pending.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (current instanceof AggregateError) {
      pending.push(...current.errors.slice(0, 8));
      continue;
    }
    const decoded = decodeFailure(current);
    if (Option.isSome(decoded)) {
      if (decoded.value.diagnostic) diagnostics.push(decoded.value.diagnostic);
      else if (decoded.value.cause !== undefined) pending.push(decoded.value.cause);
      else diagnostics.push(unknownStartupFailure);
    } else diagnostics.push(unknownStartupFailure);
  }
  return diagnostics.length > 0 ? diagnostics : [unknownStartupFailure];
}

const unknownStartupFailure: typeof StartupDiagnostic.Type = {
  dependency: 'gateway',
  operation: 'initialize-or-close',
  code: 'UnknownStartupFailure',
};
