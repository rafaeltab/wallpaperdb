import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Execution, Issues, Job, JobLive, JobStore, Time } from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
it('requires fresh accepted stages and matching current CI before reporting readiness', async () => {
  const store = controlledStore();
  let stage = 0;
  let accepted = false;
  let ci = false;
  const sent: number[] = [];
  const deps = Layer.mergeAll(
    Layer.succeed(JobStore, store),
    Layer.succeed(Time, { now: () => Effect.succeed(100) }),
    Layer.succeed(Issues, {
      pullRequest: () =>
        Effect.succeed({
          kind: 'found' as const,
          url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
          commit: 'b'.repeat(40),
          ready: ci,
          landed: false,
        }),
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
        }),
    }),
    Layer.succeed(Execution, {
      launch: () => Effect.succeed({ kind: 'submitted' as const }),
      observe: (intent) =>
        Effect.succeed({
          kind: 'found' as const,
          threadId: 't',
          status: 'completed',
          worktree: '/worker',
          branch: intent.branch,
          model: 'gpt-6.1-sol',
        }),
      inspectStage: (_intent, request) =>
        Effect.succeed({
          runId: `run-${stage}`,
          ordinal: stage + 1,
          commit: 'b'.repeat(40),
          accepted: accepted && request.index === stage,
          linked: ['https://github.com/rafaeltab/wallpaperdb/pull/999'],
        }),
      sendStage: (_intent, request) =>
        Effect.sync(() => {
          sent.push(request.index);
          stage = request.index;
          accepted = false;
        }),
    })
  );
  const run = <A>(
    effect: Effect.Effect<A, import('../src/capabilities/job/index.js').Unavailable, Job>
  ) => Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(deps)))));
  await run(
    Effect.flatMap(Job, (job) => job.start({ issue: 577, base: 'a'.repeat(40), context: '' }))
  );
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([]);
  accepted = true;
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1]);
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1]);
  accepted = true;
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1, 2]);
  accepted = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    delivery: { stage: 'ci', ready: false, landed: false },
  });
  ci = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    delivery: { stage: 'ci', ready: true, landed: false },
  });
  expect(sent).toEqual([1, 2]);
});

async function stagesFixture() {
  const store = controlledStore();
  let ordinal = 1;
  let runId = 'run-1';
  let commit = 'b'.repeat(40);
  let accepted = true;
  let links = ['https://github.com/rafaeltab/wallpaperdb/pull/999'];
  let prCommit = commit;
  let prKind: 'found' | 'absent' | 'ambiguous' = 'found';
  let sends = 0;
  let failed = false;
  let now = 100;
  let progress = 'run-1:failed';
  let waiting = false;
  let status = 'completed';
  const deps = Layer.mergeAll(
    Layer.succeed(JobStore, store),
    Layer.succeed(Time, { now: () => Effect.succeed(now) }),
    Layer.succeed(Issues, {
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
        }),
      pullRequest: () =>
        Effect.succeed(
          prKind === 'found'
            ? {
                kind: 'found' as const,
                url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
                commit: prCommit,
                ready: !failed,
                ci: { failed, progress },
                landed: false,
              }
            : { kind: prKind }
        ),
    }),
    Layer.succeed(Execution, {
      launch: () => Effect.succeed({ kind: 'submitted' as const }),
      observe: (intent) =>
        Effect.succeed({
          kind: 'found' as const,
          threadId: 'thread',
          status,
          worktree: '/worker',
          branch: intent.branch,
          model: 'gpt-6.1-sol',
        }),
      inspectStage: () =>
        Effect.succeed({
          runId,
          ordinal,
          commit,
          accepted,
          linked: links,
          waitingForGitHub: waiting,
        }),
      sendStage: (_intent, request) =>
        Effect.sync(() => {
          ordinal = request.ordinal ?? request.index + 1;
          runId = `run-${ordinal}`;
          sends++;
        }),
    })
  );
  const run = (
    operation: (
      job: import('../src/capabilities/job/index.js').Job
    ) => Effect.Effect<
      import('../src/capabilities/job/index.js').StartResult,
      import('../src/capabilities/job/index.js').Unavailable
    >
  ) =>
    Effect.runPromise(
      Effect.flatMap(Job, operation).pipe(Effect.provide(JobLive.pipe(Layer.provide(deps))))
    );
  return {
    start: () => run((job) => job.start({ issue: 577, base: 'a'.repeat(40), context: '' })),
    status: () => run((job) => job.status()),
    change: (value: {
      ordinal?: number;
      runId?: string;
      commit?: string;
      accepted?: boolean;
      links?: string[];
      prCommit?: string;
      prKind?: typeof prKind;
      failed?: boolean;
      now?: number;
      progress?: string;
      waiting?: boolean;
      status?: string;
    }) => {
      ordinal = value.ordinal ?? ordinal;
      runId = value.runId ?? runId;
      commit = value.commit ?? commit;
      accepted = value.accepted ?? accepted;
      links = value.links ?? links;
      prCommit = value.prCommit ?? prCommit;
      prKind = value.prKind ?? prKind;
      failed = value.failed ?? failed;
      now = value.now ?? now;
      progress = value.progress ?? progress;
      waiting = value.waiting ?? waiting;
      status = value.status ?? status;
    },
    sends: () => sends,
  };
}
it.each([{ accepted: false }, { ordinal: 2 }])(
  'keeps implementation pending on incompatible evidence %j',
  async (change) => {
    const job = await stagesFixture();
    job.change(change);
    expect(await job.start()).toMatchObject({
      delivery: { stage: 'implementation', ready: false },
    });
    expect(job.sends()).toBe(0);
  }
);
it('rejects the predecessor run as the next stage outcome', async () => {
  const job = await stagesFixture();
  await job.start();
  job.change({ runId: 'run-1' });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  expect(job.sends()).toBe(1);
});
it('does not accept publication that changed the reviewed commit', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change({ commit: 'c'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'publication', ready: false } });
});
it.each([
  { links: [] },
  { prCommit: 'c'.repeat(40) },
  { prKind: 'absent' as const },
  { prKind: 'ambiguous' as const },
])('does not report CI readiness without matching external publication %j', async (change) => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change(change);
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'ci', ready: false, landed: false },
  });
  expect(job.sends()).toBe(2);
});
it('invalidates displayed readiness if the current worktree changes after acceptance', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  expect(await job.status()).toMatchObject({ delivery: { ready: true } });
  job.change({ commit: 'c'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { ready: false } });
});
it('does not replace a durably associated run with another run at the same ordinal', async () => {
  const job = await stagesFixture();
  job.change({ accepted: false });
  await job.start();
  job.change({ runId: 'replacement-run', accepted: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'implementation', ready: false } });
  expect(job.sends()).toBe(0);
});

it('sends a failed current check to the same issue agent and requires review of repaired code', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change({ failed: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(job.sends()).toBe(3);
  job.change({ commit: 'c'.repeat(40), prCommit: 'c'.repeat(40), failed: false });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'publication', ready: false } });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'ci', commit: 'c'.repeat(40), ready: true },
  });
});

async function waitingJob() {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change({ failed: true });
  await job.status();
  job.change({ accepted: false, waiting: true });
  return job;
}
it('sends one continuation at an hour of unchanged explicit GitHub waiting, retaining it across fresh runtimes', async () => {
  const job = await waitingJob();
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'waiting-for-github', deadline: 3600100 },
  });
  job.change({ now: 3600099 });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ now: 3600100 });
  await job.status();
  expect(job.sends()).toBe(4);
  job.change({ now: 7200101 });
  await job.status();
  await job.status();
  expect(job.sends()).toBe(4);
});
it('restarts the hour on actual CI progress and does not nudge ongoing work or human questions', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3600099, progress: 'run-2:step-3-completed' });
  await job.status();
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ now: 7200099, status: 'running' });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ status: 'waiting-for-input' });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ status: 'completed', waiting: false });
  await job.status();
  expect(job.sends()).toBe(3);
});
it('does not nudge from a stale or wrong-ordinal waiting observation', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3600101, ordinal: 3 });
  await job.status();
  expect(job.sends()).toBe(3);
});
