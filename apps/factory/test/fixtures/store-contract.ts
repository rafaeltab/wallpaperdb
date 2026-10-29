import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { Intent, JobStore } from '../../src/capabilities/job/index.js';
export function storeContract(
  name: string,
  setup: () => Promise<{ store: JobStore; reopen: () => JobStore; close: () => Promise<void> }>
) {
  it(`${name}: keeps the winning intent and one launch claim across concurrent callers and reopen`, async () => {
    const fixture = await setup();
    try {
      const intent: Intent = {
        id: '1',
        issue: 576,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
        base: 'a'.repeat(40),
        context: 'Only this issue',
        branch: 'factory/job-1',
        createdAt: 100,
        expectedStage: 'implementation',
      };
      expect(await Effect.runPromise(fixture.store.read())).toBeNull();
      const results = await Promise.all([
        Effect.runPromise(fixture.store.reserve(intent)),
        Effect.runPromise(fixture.store.reserve({ ...intent, id: '2' })),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = await Effect.runPromise(fixture.store.read());
      expect(saved).toMatchObject({ issue: 576, expectedStage: 'implementation' });
      expect(await Effect.runPromise(fixture.reopen().read())).toEqual(saved);
      const claims = await Promise.all([
        Effect.runPromise(fixture.store.claimLaunch()),
        Effect.runPromise(fixture.reopen().claimLaunch()),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await Effect.runPromise(fixture.reopen().claimLaunch())).toBe(false);
    } finally {
      await fixture.close();
    }
  });
}
