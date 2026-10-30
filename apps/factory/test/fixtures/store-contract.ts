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
      const wait = {
        revision: 0,
        progress: 'current-run:step-completed',
        deadline: 3600100,
        nudged: false,
      };
      expect(await Effect.runPromise(fixture.store.readWait())).toBeNull();
      const waits = await Promise.all(
        [fixture.store.saveWait(wait), fixture.reopen().saveWait({ ...wait, deadline: 999 })].map(
          (effect) => Effect.runPromise(effect)
        )
      );
      expect(waits.filter(Boolean)).toHaveLength(1);
      const savedWait = await Effect.runPromise(fixture.reopen().readWait());
      expect(savedWait).toEqual(waits[0] ? wait : { ...wait, deadline: 999 });
      expect(await Effect.runPromise(fixture.reopen().saveWait(wait))).toBe(false);
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
      const continuation = {
        ...stage,
        index: 4,
        ordinal: 4,
        stage: 'babysitting' as const,
        continuation: true,
      };
      const pending = { ...wait, revision: 1, nudged: true, continuation };
      expect(await Effect.runPromise(fixture.store.saveWait(pending))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().readWait())).toEqual(pending);
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
      const repair = { ...stage, index: 4, stage: 'babysitting' as const, ordinal: 4 };
      expect(await Effect.runPromise(fixture.store.bindRun(repair, 'repair-4', 4))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().bindRun(repair, 'watcher-5', 5))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().bindRun(repair, 'watcher-5', 5))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().bindRun(repair, 'replacement-5', 5))).toBe(
        false
      );
      expect(await Effect.runPromise(fixture.reopen().bindRun(repair, 'repair-4', 4))).toBe(true);
    } finally {
      await fixture.close();
    }
  });
  it(`${name}: preserves parking and serializes cancellation against delivery across reopen`, async () => {
    const fixture = await setup();
    try {
      const control = {
        revision: 0,
        cancelled: false,
        claimed: [],
        parked: {
          index: 0,
          run: { id: 'run-1', ordinal: 1 },
          question: { id: 'q', text: 'Choose?' },
        },
      };
      expect(await Effect.runPromise(fixture.store.saveControl(control))).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().readControl())).toEqual(control);
      const commands = await Promise.all([
        Effect.runPromise(fixture.store.saveControl({ ...control, revision: 1, cancelled: true })),
        Effect.runPromise(
          fixture.reopen().saveControl({
            ...control,
            revision: 1,
            parked: { index: 0, question: { id: 'new', text: 'New question' } },
          })
        ),
      ]);
      expect(commands.filter(Boolean)).toHaveLength(1);
      const saved = await Effect.runPromise(fixture.reopen().readControl());
      expect(saved).toEqual(
        commands[0]
          ? { ...control, revision: 1, cancelled: true }
          : {
              ...control,
              revision: 1,
              parked: { index: 0, question: { id: 'new', text: 'New question' } },
            }
      );
      if (!saved.cancelled)
        expect(
          await Effect.runPromise(
            fixture.store.saveControl({ ...saved, revision: 2, cancelled: true })
          )
        ).toBe(true);
      expect(await Effect.runPromise(fixture.reopen().claimStage(9))).toBe(false);
    } finally {
      await fixture.close();
    }
  });
}
