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
      const requests = [
        intent,
        {
          ...intent,
          id: '2',
          base: 'b'.repeat(40),
          context: 'Different scope',
          branch: 'factory/job-2',
        },
      ];
      const results = await Promise.all(
        requests.map((request) => Effect.runPromise(fixture.store.reserve(request)))
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = await Effect.runPromise(fixture.store.read());
      expect(saved).toEqual(requests[results.findIndex(Boolean)]);
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
