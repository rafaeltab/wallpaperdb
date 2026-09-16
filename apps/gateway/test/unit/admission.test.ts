import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Admission, Quota, admissionLayer } from '../../src/admission/index.js';
import { memoryQuotaLayer } from '../helpers/quota.js';

const policy = { enabled: true, limit: 2, windowMs: 1000 };
const layer = admissionLayer(policy).pipe(Layer.provide(memoryQuotaLayer));
describe('request admission', () => {
  it.effect('admits only the configured quota and renews it when the window ends', () =>
    Effect.gen(function* () {
      const admission = yield* Admission;
      expect(yield* admission.admit('visitor')).toEqual({
        _tag: 'Allowed',
        remaining: 1,
        reset: 1000,
      });
      expect(yield* admission.admit('visitor')).toEqual({
        _tag: 'Allowed',
        remaining: 0,
        reset: 1000,
      });
      expect(yield* admission.admit('visitor')).toEqual({ _tag: 'Limited', retryAfter: 1000 });
      yield* TestClock.adjust('1 second');
      expect(yield* admission.admit('visitor')).toEqual({
        _tag: 'Allowed',
        remaining: 1,
        reset: 2000,
      });
    }).pipe(Effect.provide(layer))
  );
  it.effect('isolates visitors and application instances', () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const admission = yield* Admission;
        yield* Effect.all([admission.admit('a'), admission.admit('a')], {
          concurrency: 'unbounded',
        });
        expect(yield* admission.admit('a')).toMatchObject({ _tag: 'Limited' });
        expect(yield* admission.admit('b')).toMatchObject({ _tag: 'Allowed', remaining: 1 });
      }).pipe(Effect.provide(layer));
      expect(
        yield* Admission.use((admission) => admission.admit('a')).pipe(
          Effect.provide(Layer.fresh(layer))
        )
      ).toMatchObject({ _tag: 'Allowed', remaining: 1 });
    })
  );
  it.effect('does not consume a quota when disabled', () =>
    Effect.gen(function* () {
      const disabled = admissionLayer({ ...policy, enabled: false }).pipe(
        Layer.provide(
          Layer.succeed(Quota, {
            take: () => Effect.die('must not consume'),
          })
        )
      );
      expect(
        yield* Admission.use((admission) => admission.admit('visitor')).pipe(
          Effect.provide(disabled)
        )
      ).toEqual({
        _tag: 'Allowed',
        remaining: 2,
        reset: 1000,
      });
    })
  );
});
