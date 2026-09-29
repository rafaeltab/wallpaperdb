import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Admission, Quota, admissionLayer } from '../../src/capabilities/admission/index.js';
import { memoryQuotaLayer } from '../helpers/quota.js';

const policy = { enabled: true, limit: 2, windowMs: 1000 };
const layer = admissionLayer(policy).pipe(Layer.provide(memoryQuotaLayer));
describe('request admission', () => {
  it.effect('charges resolved cost and 100 points for inspection rejection without refunds', () =>
    Effect.gen(function* () {
      const admission = yield* Admission;
      expect(yield* admission.admit('weighted', { _tag: 'Valid', cost: 150 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 150,
      });
      expect(yield* admission.admit('weighted', { _tag: 'Rejected' })).toMatchObject({
        _tag: 'Allowed',
        remaining: 50,
      });
      expect(yield* admission.admit('weighted', { _tag: 'Valid', cost: 60 })).toMatchObject({
        _tag: 'Limited',
      });
      expect(yield* admission.admit('weighted', { _tag: 'Valid', cost: 50 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      expect(yield* admission.admit('weighted', { _tag: 'Valid', cost: 0 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
    }).pipe(
      Effect.provide(
        admissionLayer({ enabled: true, limit: 300, windowMs: 1000 }).pipe(
          Layer.provide(memoryQuotaLayer)
        )
      )
    )
  );
  it.effect('passes the configured policy to the quota adapter and forwards its decisions', () =>
    Effect.gen(function* () {
      const admission = yield* Admission;
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Allowed',
        remaining: 1,
        reset: 1000,
      });
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Allowed',
        remaining: 0,
        reset: 1000,
      });
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Limited',
        retryAfter: 1000,
      });
      yield* TestClock.adjust('1 second');
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Allowed',
        remaining: 1,
        reset: 2000,
      });
    }).pipe(Effect.provide(layer))
  );
  it.effect('passes visitor keys to independently provided quota adapters', () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const admission = yield* Admission;
        yield* Effect.all(
          [
            admission.admit('a', { _tag: 'Valid', cost: 1 }),
            admission.admit('a', { _tag: 'Valid', cost: 1 }),
          ],
          {
            concurrency: 'unbounded',
          }
        );
        expect(yield* admission.admit('a', { _tag: 'Valid', cost: 1 })).toMatchObject({
          _tag: 'Limited',
        });
        expect(yield* admission.admit('b', { _tag: 'Valid', cost: 1 })).toMatchObject({
          _tag: 'Allowed',
          remaining: 1,
        });
      }).pipe(Effect.provide(layer));
      expect(
        yield* Admission.use((admission) => admission.admit('a', { _tag: 'Valid', cost: 1 })).pipe(
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
        yield* Admission.use((admission) =>
          admission.admit('visitor', { _tag: 'Valid', cost: 1 })
        ).pipe(Effect.provide(disabled))
      ).toEqual({
        _tag: 'Allowed',
        remaining: 2,
        reset: 1000,
      });
    })
  );
});
