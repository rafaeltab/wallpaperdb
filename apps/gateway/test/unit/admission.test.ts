import { Effect, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { createAdmission } from '../../src/admission/index.js';
import { createMemoryQuota } from '../../src/adapters/redis/index.js';

const policy = { enabled: true, limit: 2, windowMs: 1000 };
describe('request admission', () => {
  it('admits only the configured quota and renews it when the window ends', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const admission = createAdmission(createMemoryQuota(), policy);
        expect(yield* admission.admit('visitor')).toMatchObject({ _tag: 'Allowed', remaining: 1 });
        expect(yield* admission.admit('visitor')).toMatchObject({ _tag: 'Allowed', remaining: 0 });
        expect(yield* admission.admit('visitor')).toEqual({ _tag: 'Limited', retryAfter: 1000 });
        yield* TestClock.adjust('1 second');
        expect(yield* admission.admit('visitor')).toMatchObject({ _tag: 'Allowed', remaining: 1 });
      }).pipe(Effect.provide(TestContext.TestContext))
    );
  });
  it('isolates visitors and application instances', async () => {
    const admission = createAdmission(createMemoryQuota(), policy);
    await Effect.runPromise(Effect.all([admission.admit('a'), admission.admit('a')]));
    expect(await Effect.runPromise(admission.admit('b'))).toMatchObject({ _tag: 'Allowed' });
    expect(
      await Effect.runPromise(createAdmission(createMemoryQuota(), policy).admit('a'))
    ).toMatchObject({ _tag: 'Allowed' });
  });
  it('does not consume a quota when disabled', async () => {
    const admission = createAdmission(
      { take: () => Effect.die('must not consume') },
      { ...policy, enabled: false }
    );
    expect(await Effect.runPromise(admission.admit('visitor'))).toMatchObject({
      _tag: 'Allowed',
      remaining: 2,
    });
  });
});
