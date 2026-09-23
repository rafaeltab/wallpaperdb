import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Admission, admissionLayer } from '../../src/admission/index.js';
import { memoryQuotaLayer } from '../../src/adapters/quota/index.js';

const layer = admissionLayer({ limit: 2, windowMs: 1000 }).pipe(Layer.provide(memoryQuotaLayer));
describe('upload admission', () => {
  it.effect('bounds uploads per Profile without extending a denied window', () =>
    Effect.gen(function* () {
      const admission = yield* Admission;
      expect(yield* admission.admit({ profileId: 'alice' })).toEqual({ _tag: 'Allowed', remaining: 1, reset: 1000 });
      expect(yield* admission.admit({ profileId: 'alice' })).toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(yield* admission.admit({ profileId: 'alice' })).toEqual({ _tag: 'Limited', retryAfter: 1, reset: 1000 });
      yield* TestClock.adjust('1 second');
      expect(yield* admission.admit({ profileId: 'alice' })).toEqual({ _tag: 'Allowed', remaining: 1, reset: 2000 });
    }).pipe(Effect.provide(layer))
  );
});
