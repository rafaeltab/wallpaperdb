import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { expect } from 'vitest';
import { memoryQuotaLayer } from '../../src/adapters/quota/index.js';
import { Quota } from '../../src/admission/index.js';

it.effect('bounds local Profile windows without losing existing quotas and frees expired capacity', () =>
  Effect.gen(function* () {
    const quota = yield* Quota;
    for (let index = 0; index < 10_000; index++) {
      yield* quota.take(`profile-${index}`, 1, 1_000);
    }
    expect(yield* quota.take('overflow', 1, 1_000)).toMatchObject({ _tag: 'Limited' });
    expect(yield* quota.take('profile-0', 1, 1_000)).toMatchObject({ _tag: 'Limited' });
    yield* TestClock.adjust('1 second');
    expect(yield* quota.take('overflow', 1, 1_000)).toMatchObject({
      _tag: 'Allowed', remaining: 0,
    });
  }).pipe(Effect.provide(memoryQuotaLayer))
);

it.effect('expires each Profile window independently', () =>
  Effect.gen(function* () {
    const quota = yield* Quota;
    yield* quota.take('early', 1, 1_000);
    yield* quota.take('later', 1, 2_000);
    yield* TestClock.adjust('1 second');
    expect(yield* quota.take('early', 1, 1_000)).toMatchObject({ _tag: 'Allowed' });
    expect(yield* quota.take('later', 1, 2_000)).toEqual({
      _tag: 'Limited', reset: 2_000, retryAfter: 1,
    });
  }).pipe(Effect.provide(memoryQuotaLayer))
);
