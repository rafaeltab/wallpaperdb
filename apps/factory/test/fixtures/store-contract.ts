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
      const stage = {
        index: 1,
        stage: 'review' as const,
        threadId: 'thread-1',
        commit: 'c'.repeat(40),
        previousRunId: 'run-1',
      };
      expect(await Effect.runPromise(fixture.store.readStage(1))).toBeNull();
      const writes = await Promise.all(
        [
          fixture.store.saveStage(stage),
          fixture.reopen().saveStage({ ...stage, commit: 'd'.repeat(40) }),
        ].map((effect) => Effect.runPromise(effect))
      );
      expect(writes.filter(Boolean)).toHaveLength(1);
      expect(await Effect.runPromise(fixture.reopen().readStage(1))).toEqual(
        writes[0] ? stage : { ...stage, commit: 'd'.repeat(40) }
      );
      const sends = await Promise.all(
        [fixture.store.claimStage(1), fixture.reopen().claimStage(1)].map((effect) =>
          Effect.runPromise(effect)
        )
      );
      expect(sends.filter(Boolean)).toHaveLength(1);
      expect(await Effect.runPromise(fixture.reopen().claimStage(1))).toBe(false);
      const bindings = await Promise.all(
        ['run-2', 'replacement'].map((runId) =>
          Effect.runPromise(fixture.store.bindRun(stage, runId))
        )
      );
      expect(bindings.filter(Boolean)).toHaveLength(1);
      const winner = bindings[0] ? 'run-2' : 'replacement';
      const loser = bindings[0] ? 'replacement' : 'run-2';
      expect(await Effect.runPromise(fixture.reopen().bindRun(stage, winner))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().bindRun(stage, loser))).toBe(false);
    } finally {
      await fixture.close();
    }
  });
}
