import { describe, expect, it } from 'vitest';
import { nativeFailureCode, startupDiagnostics } from '../../src/startup-diagnostics.js';

describe('Safe startup diagnostics', () => {
  const diagnostic = {
    dependency: 'opensearch',
    operation: 'inspect-index',
    code: 'ConnectionError',
    index: 'catalogue',
  };

  it('reconstructs approved fields through startup and cleanup wrappers without serializing causes', () => {
    const secret = 'private-diagnostic-value';
    const failure = new AggregateError(
      [
        {
          _tag: 'GatewayStartupError',
          cause: {
            _tag: 'OpenSearchStartupError',
            diagnostic: { ...diagnostic, password: secret },
            cause: {
              message: secret,
              toJSON: () => {
                throw new Error('Must not serialize vendor causes');
              },
            },
          },
        },
        new Error(secret),
      ],
      secret
    );
    const result = startupDiagnostics(failure);
    expect(result).toEqual([
      expect.objectContaining({ code: 'UnknownStartupFailure' }),
      diagnostic,
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('does not trust diagnostic-shaped properties on unknown errors', () => {
    expect(startupDiagnostics({ diagnostic, cause: { _tag: 'BrokerError', diagnostic } })).toEqual([
      expect.objectContaining({ code: 'UnknownStartupFailure' }),
    ]);
    expect(
      startupDiagnostics({
        _tag: 'BrokerError',
        diagnostic: { ...diagnostic, statusCode: 'private' },
      })
    ).toEqual([expect.objectContaining({ code: 'UnknownStartupFailure' })]);
    expect(startupDiagnostics({ _tag: 'BrokerError' })).toEqual([
      expect.objectContaining({ code: 'UnknownStartupFailure' }),
    ]);
  });

  it('bounds cyclic, deep and broad failure graphs', () => {
    const cycle: { _tag: string; cause?: unknown } = { _tag: 'GatewayStartupError' };
    cycle.cause = cycle;
    expect(startupDiagnostics(cycle)).toEqual([
      expect.objectContaining({ code: 'UnknownStartupFailure' }),
    ]);
    let deep: unknown = { _tag: 'OpenSearchStartupError', diagnostic };
    for (let depth = 0; depth < 20; depth++) deep = { _tag: 'GatewayStartupError', cause: deep };
    expect(startupDiagnostics(deep)).toEqual([
      expect.objectContaining({ code: 'UnknownStartupFailure' }),
    ]);
    const broad = new AggregateError(
      Array.from({ length: 100 }, () => ({ _tag: 'OpenSearchStartupError', diagnostic }))
    );
    expect(startupDiagnostics(broad)).toEqual(Array.from({ length: 8 }, () => diagnostic));
  });

  it('retains recognized native codes without copying arbitrary text', () => {
    expect(nativeFailureCode(Object.assign(new Error('private'), { code: 'EADDRINUSE' }))).toBe(
      'EADDRINUSE'
    );
    expect(nativeFailureCode({ code: 'ERR_MODULE_NOT_FOUND', message: 'private' })).toBe(
      'ERR_MODULE_NOT_FOUND'
    );
    expect(nativeFailureCode({ code: 'private', message: 'private' })).toBe('UnknownError');
  });
});
