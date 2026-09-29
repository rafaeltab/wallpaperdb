import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import {
  Admission,
  Quota,
  QuotaUnavailable,
  admissionLayer as makeAdmissionLayer,
} from '../../src/capabilities/admission/index.js';
import { memoryQuotaLayer, quietAdmissionTelemetry } from '../helpers/quota.js';

const fallback = { capacity: 100000, refillMs: 60000, maxVisitors: 10000 };
const policy = { fallback, enabled: true, limit: 2, windowMs: 1000 };
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
        admissionLayer({ enabled: true, limit: 300, windowMs: 1000, fallback }).pipe(
          Layer.provide(memoryQuotaLayer)
        )
      )
    )
  );
  it.effect('refills cost continuously and bases retry on the missing points', () =>
    Effect.gen(function* () {
      const admission = yield* Admission;
      yield* admission.admit('refill', { _tag: 'Valid', cost: 300 });
      yield* TestClock.adjust('250 millis');
      expect(yield* admission.admit('refill', { _tag: 'Valid', cost: 150 })).toEqual({
        _tag: 'Limited',
        retryAfter: 250,
      });
      expect(yield* admission.admit('refill', { _tag: 'Valid', cost: 75 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      yield* TestClock.adjust('2 seconds');
      expect(yield* admission.admit('refill', { _tag: 'Valid', cost: 300 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
    }).pipe(
      Effect.provide(
        admissionLayer({ enabled: true, limit: 300, windowMs: 1000, fallback }).pipe(
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
        reset: 500,
      });
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Allowed',
        remaining: 0,
        reset: 1000,
      });
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Limited',
        retryAfter: 500,
      });
      yield* TestClock.adjust('1 second');
      expect(yield* admission.admit('visitor', { _tag: 'Valid', cost: 1 })).toEqual({
        _tag: 'Allowed',
        remaining: 1,
        reset: 1500,
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

describe('degraded admission', () => {
  it.effect('charges local weighted cost, refills, and resumes shared state without merging', () =>
    Effect.gen(function* () {
      let available = false;
      const sharedCosts: number[] = [];
      const admission = yield* Admission.pipe(
        Effect.provide(
          admissionLayer({
            enabled: true,
            limit: 1000,
            windowMs: 1000,
            fallback: { capacity: 300, refillMs: 1000, maxVisitors: 2 },
          }).pipe(
            Layer.provide(
              Layer.succeed(Quota, {
                take: (_visitor, _limit, _period, cost) =>
                  available
                    ? Effect.sync(() => {
                        sharedCosts.push(cost);
                        return { _tag: 'Allowed', remaining: 1000 - cost, reset: 1000 };
                      })
                    : Effect.fail(new QuotaUnavailable({ reason: 'unavailable' })),
              })
            )
          )
        )
      );
      expect(yield* admission.admit('a', { _tag: 'Valid', cost: 200 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 100,
        limit: 300,
      });
      expect(yield* admission.admit('a', { _tag: 'Valid', cost: 200 })).toMatchObject({
        _tag: 'Limited',
        retryAfter: 334,
        limit: 300,
      });
      expect(yield* admission.admit('a', { _tag: 'Rejected' })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      yield* TestClock.adjust('500 millis');
      expect(yield* admission.admit('a', { _tag: 'Valid', cost: 150 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      available = true;
      expect(yield* admission.admit('a', { _tag: 'Valid', cost: 300 })).toMatchObject({
        _tag: 'Allowed',
        remaining: 700,
      });
      expect(sharedCosts).toEqual([300]);
    })
  );
  it.effect(
    'bounds local identities without evicting depleted budgets and expires full buckets',
    () =>
      Effect.gen(function* () {
        const admission = yield* Admission;
        expect(yield* admission.admit('a', { _tag: 'Valid', cost: 100 })).toMatchObject({
          _tag: 'Allowed',
        });
        expect(yield* admission.admit('b', { _tag: 'Valid', cost: 100 })).toMatchObject({
          _tag: 'Saturated',
        });
        expect(yield* admission.admit('a', { _tag: 'Valid', cost: 100 })).toMatchObject({
          _tag: 'Limited',
        });
        yield* TestClock.adjust('1 second');
        expect(yield* admission.admit('b', { _tag: 'Valid', cost: 100 })).toMatchObject({
          _tag: 'Allowed',
        });
      }).pipe(
        Effect.provide(
          admissionLayer({
            enabled: true,
            limit: 1000,
            windowMs: 1000,
            fallback: { capacity: 100, refillMs: 1000, maxVisitors: 1 },
          }).pipe(
            Layer.provide(
              Layer.succeed(Quota, {
                take: () => Effect.fail(new QuotaUnavailable({ reason: 'command_failure' })),
              })
            )
          )
        )
      )
  );
});

it.effect(
  'uses independent per-replica outage state and never falls back on command saturation',
  () =>
    Effect.gen(function* () {
      let saturated = false;
      const localLayer = admissionLayer({
        ...policy,
        fallback: { capacity: 100, refillMs: 1000, maxVisitors: 2 },
      }).pipe(
        Layer.provide(
          Layer.succeed(Quota, {
            take: () =>
              saturated
                ? Effect.succeed({ _tag: 'Saturated' })
                : Effect.fail(new QuotaUnavailable({ reason: 'unavailable' })),
          })
        )
      );
      const a = yield* Admission.pipe(Effect.provide(Layer.fresh(localLayer)));
      const b = yield* Admission.pipe(Effect.provide(Layer.fresh(localLayer)));
      saturated = true;
      expect(yield* a.admit('same', { _tag: 'Rejected' })).toEqual({ _tag: 'Saturated' });
      saturated = false;
      expect(yield* a.admit('same', { _tag: 'Rejected' })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      expect(yield* a.admit('same', { _tag: 'Rejected' })).toMatchObject({ _tag: 'Limited' });
      expect(yield* b.admit('same', { _tag: 'Rejected' })).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
    })
);

function admissionLayer(policy: Parameters<typeof makeAdmissionLayer>[0]) {
  return makeAdmissionLayer(policy).pipe(Layer.provide(quietAdmissionTelemetry));
}
