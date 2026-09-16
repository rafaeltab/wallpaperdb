import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { Admission, Quota, admissionLayer } from '../../src/admission/index.js';
import { memoryQuotaLayer } from '../helpers/quota.js';

const policy = { enabled: true, limit: 2, windowMs: 1000 };
const layer = admissionLayer(policy).pipe(Layer.provide(memoryQuotaLayer));
describe('request admission', () => {
  it('admits only the configured quota and renews it when the window ends', async () => {
    await Effect.runPromise(
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
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
    );
  });
  it('isolates visitors and application instances', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const admission = yield* Admission;
        yield* Effect.all([admission.admit('a'), admission.admit('a')], {
          concurrency: 'unbounded',
        });
        expect(yield* admission.admit('a')).toMatchObject({ _tag: 'Limited' });
        expect(yield* admission.admit('b')).toMatchObject({ _tag: 'Allowed', remaining: 1 });
      }).pipe(Effect.provide(layer))
    );
    expect(
      await Effect.runPromise(
        Admission.use((admission) => admission.admit('a')).pipe(Effect.provide(Layer.fresh(layer)))
      )
    ).toMatchObject({ _tag: 'Allowed', remaining: 1 });
  });
  it('does not consume a quota when disabled', async () => {
    const disabled = admissionLayer({ ...policy, enabled: false }).pipe(
      Layer.provide(
        Layer.succeed(Quota, {
          take: () => Effect.die('must not consume'),
        })
      )
    );
    expect(
      await Effect.runPromise(
        Admission.use((admission) => admission.admit('visitor')).pipe(
          Effect.provide(disabled),
          Effect.provide(TestClock.layer())
        )
      )
    ).toEqual({
      _tag: 'Allowed',
      remaining: 2,
      reset: 1000,
    });
  });
});
