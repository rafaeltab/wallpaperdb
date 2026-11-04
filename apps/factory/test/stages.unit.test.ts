import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Execution,
  Issues,
  Job,
  JobLive,
  JobStore,
  Time,
  Unavailable,
} from '../src/capabilities/job/index.js';
import { ContinuationAdmission } from '../src/capabilities/job/index.js';
import {
  Scheduler,
  SchedulerLive,
  ScheduleStore,
  JobPool,
  Plan,
  PlanningSource,
} from '../src/capabilities/plan/index.js';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
import { controlledStore } from './fixtures/store.js';

it('requires fresh accepted stages and matching current CI before reporting readiness', async () => {
  const store = controlledStore();
  let stage = 0;
  let accepted = false;
  let ci = false;
  let landed = false;
  let publicationAvailable = true;
  const sent: number[] = [];
  const deps = Layer.mergeAll(
    Layer.succeed(JobStore, store),
    Layer.succeed(Time, { now: () => Effect.succeed(100) }),
    Layer.succeed(Issues, {
      pullRequest: () =>
        !publicationAvailable
          ? Effect.succeed({ kind: 'ambiguous' as const })
          : Effect.succeed({
              kind: 'found' as const,
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
              commit: 'b'.repeat(40),
              ready: ci,
              landed,
            }),
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockers: [],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
        }),
    }),
    Layer.succeed(Execution, {
      interrupt: () => Effect.void,
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
  publicationAvailable = false;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    prerequisite: { commit: 'b'.repeat(40) },
    delivery: { ready: false, pr: { kind: 'ambiguous' } },
  });
  publicationAvailable = true;
  ci = false;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    prerequisite: {
      url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
      commit: 'b'.repeat(40),
    },
    delivery: { ready: false },
  });
  landed = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    delivery: { ready: false, landed: true, active: false },
  });
  expect(sent).toEqual([1, 2]);
});

async function stagesFixture(admission?: ContinuationAdmission) {
  const store = controlledStore();
  let ordinal = 1;
  let runId = 'run-1';
  let commit = 'b'.repeat(40);
  let accepted = true;
  let links = ['https://github.com/rafaeltab/wallpaperdb/pull/999'];
  let prCommit = commit;
  let reviewedCommit: string | undefined;
  let owningHeads: readonly string[] | undefined;
  let prKind: 'found' | 'absent' | 'ambiguous' = 'found';
  let sends = 0;
  let interrupts = 0;
  let answeredQuestions: readonly string[] = [];
  let failed = false;
  let maintenancePending = false;
  let manualRecovery = false;
  let repairAllowed = true;
  const repairs: unknown[] = [];
  let publicationRetryAllowed = false;
  const publicationRetries: unknown[] = [];
  let now = 100;
  let progress = 'run-1:failed';
  let waiting = false;
  let status = 'completed';
  let runningAfterSend = false;
  let loseSend = false;
  let ambiguous = false;
  let missingEvidence = false;
  let worktreeClean = true;
  let stageIndex: number | undefined;
  let question: { id: string; text: string } | undefined;
  const baseDeps = Layer.mergeAll(
    Layer.succeed(JobStore, store),
    Layer.succeed(Time, { now: () => Effect.succeed(now) }),
    Layer.succeed(Issues, {
      claimPublicationRetry: (_intent, request, evidence) =>
        Effect.sync(() => {
          publicationRetries.push({ request, evidence });
          return publicationRetryAllowed;
        }),
      repairReplay: (_intent, head, repaired, authority) =>
        Effect.sync(() => {
          repairs.push({ head, repaired, authority });
          return repairAllowed;
        }),
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockers: [],
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
                reviewedCommit,
                owningHeads,
                parent: 'e'.repeat(40),
                base: 'D',
                maintenancePending,
                manualRecovery,
                ready: !failed,
                ci: { failed, progress },
                landed: false,
              }
            : { kind: prKind }
        ),
    }),
    Layer.succeed(Execution, {
      interrupt: () =>
        Effect.sync(() => {
          interrupts++;
        }),
      launch: () => Effect.succeed({ kind: 'submitted' as const }),
      observe: (intent) =>
        Effect.succeed({
          kind: ambiguous ? ('ambiguous' as const) : ('found' as const),
          threadId: 'thread',
          status,
          question,
          answeredQuestions,
          run: { id: runId, ordinal },
          worktree: '/worker',
          branch: intent.branch,
          model: 'gpt-6.1-sol',
        }),
      inspectStage: () =>
        Effect.succeed(
          missingEvidence
            ? null
            : {
                runId,
                ordinal,
                commit,
                accepted,
                linked: links,
                waitingForGitHub: waiting,
                worktreeClean,
                stageIndex,
              }
        ),
      sendStage: (_intent, request) =>
        Effect.gen(function* () {
          sends++;
          if (loseSend)
            return yield* Effect.fail(new Unavailable({ operation: 'lost-send', cause: null }));
          ordinal = request.ordinal ?? request.index + 1;
          runId = `run-${ordinal}`;
          if (runningAfterSend) status = 'running';
        }),
    })
  );
  const deps = admission
    ? Layer.merge(baseDeps, Layer.succeed(ContinuationAdmission, admission))
    : baseDeps;
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
    repairs: () => repairs,
    publicationRetries: () => publicationRetries,
    start: () => run((job) => job.start({ issue: 577, base: 'a'.repeat(40), context: '' })),
    status: () => run((job) => job.status()),
    cancel: (id: string) => run((job) => job.cancel(id)),
    resume: (command: import('../src/capabilities/job/index.js').Resume) =>
      run((job) => job.resume(command)),
    change: (value: {
      runningAfterSend?: boolean;
      loseSend?: boolean;
      ambiguous?: boolean;
      missingEvidence?: boolean;
      worktreeClean?: boolean;
      ordinal?: number;
      runId?: string;
      commit?: string;
      accepted?: boolean;
      links?: string[];
      prCommit?: string;
      reviewedCommit?: string;
      owningHeads?: readonly string[];
      prKind?: typeof prKind;
      failed?: boolean;
      maintenancePending?: boolean;
      manualRecovery?: boolean;
      repairAllowed?: boolean;
      publicationRetryAllowed?: boolean;
      now?: number;
      progress?: string;
      waiting?: boolean;
      status?: string;
      stageIndex?: number;
      question?: { id: string; text: string };
      answeredQuestions?: readonly string[];
    }) => {
      runningAfterSend = value.runningAfterSend ?? runningAfterSend;
      loseSend = value.loseSend ?? loseSend;
      ambiguous = value.ambiguous ?? ambiguous;
      missingEvidence = value.missingEvidence ?? missingEvidence;
      worktreeClean = value.worktreeClean ?? worktreeClean;
      ordinal = value.ordinal ?? ordinal;
      runId = value.runId ?? runId;
      commit = value.commit ?? commit;
      accepted = value.accepted ?? accepted;
      links = value.links ?? links;
      prCommit = value.prCommit ?? prCommit;
      reviewedCommit = value.reviewedCommit ?? reviewedCommit;
      owningHeads = value.owningHeads ?? owningHeads;
      prKind = value.prKind ?? prKind;
      failed = value.failed ?? failed;
      maintenancePending = value.maintenancePending ?? maintenancePending;
      manualRecovery = value.manualRecovery ?? manualRecovery;
      repairAllowed = value.repairAllowed ?? repairAllowed;
      publicationRetryAllowed = value.publicationRetryAllowed ?? publicationRetryAllowed;
      now = value.now ?? now;
      progress = value.progress ?? progress;
      waiting = value.waiting ?? waiting;
      status = value.status ?? status;
      stageIndex = value.stageIndex ?? stageIndex;
      question = value.question;
      answeredQuestions = value.answeredQuestions ?? answeredQuestions;
    },
    sends: () => sends,
    interrupts: () => interrupts,
    store,
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

it('recovers a persisted continuation decision interrupted before its stage record without a second send', async () => {
  const job = await waitingJob();
  await job.status();
  const saved = await Effect.runPromise(job.store.readWait());
  const request = await Effect.runPromise(job.store.readStage(4));
  if (!saved || !request) throw new Error('Expected existing wait and repair stage');
  const continuation = {
    ...request,
    index: 5,
    ordinal: 5,
    previousRunId: 'run-4',
    continuation: true,
  };
  await Effect.runPromise(
    job.store.saveWait({ ...saved, revision: saved.revision + 1, nudged: true, continuation })
  );
  await job.status();
  await job.status();
  expect(job.sends()).toBe(4);
  expect(await Effect.runPromise(job.store.readStage(5))).toEqual(continuation);
});
it('does not nudge an unbound replacement run at the expected ordinal', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3600101, runId: 'replacement' });
  await job.status();
  expect(job.sends()).toBe(3);
});
it('allows a full new hour after meaningful CI progress before one continuation', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3500000, progress: 'run-2:job-3-completed' });
  await job.status();
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ now: 7099999 });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ now: 7100001 });
  await job.status();
  expect(job.sends()).toBe(4);
});
it('keeps babysitting pending when GitHub cannot identify its PR', async () => {
  const job = await waitingJob();
  job.change({ prKind: 'ambiguous', now: 3600101 });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(job.sends()).toBe(3);
});
it('does not continue waiting against a PR head that differs from the expected agent commit', async () => {
  const job = await waitingJob();
  job.change({ prCommit: 'c'.repeat(40) });
  await job.status();
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(3);
});
it('continues an explicitly associated watcher run and uses its ordinal for the next stage', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ ordinal: 5, runId: 'watcher-5', stageIndex: 4 });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'waiting-for-github', deadline: 3600100 },
  });
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(4);
  expect(await Effect.runPromise(job.store.readStage(5))).toMatchObject({
    ordinal: 6,
    previousRunId: 'watcher-5',
  });
});
it('accepts successful current watcher completion only for the owning repair stage', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ ordinal: 5, runId: 'watcher-5', stageIndex: 99, accepted: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  job.change({ stageIndex: 4 });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  expect(await Effect.runPromise(job.store.readStage(5))).toMatchObject({
    ordinal: 6,
    previousRunId: 'watcher-5',
  });
});
it('retains the original GitHub deadline across an active watcher turn without sending while active', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3500000, ordinal: 5, runId: 'watcher-5', status: 'running', waiting: false });
  expect(await job.status()).toMatchObject({ delivery: { activity: 'repairing' } });
  expect(await Effect.runPromise(job.store.readWait())).toMatchObject({
    progress: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:run-1:failed',
    deadline: 3600100,
  });
  expect(job.sends()).toBe(3);
  job.change({ now: 3500100, status: 'completed', waiting: true, stageIndex: 4 });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'waiting-for-github', deadline: 3600100 },
  });
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(4);
});
it('does not count a human-question interruption as continued GitHub waiting', async () => {
  const job = await waitingJob();
  await job.status();
  job.change({ now: 3500000, status: 'waiting-for-input', waiting: false });
  await job.status();
  expect(job.sends()).toBe(3);
  job.change({ now: 3500100, status: 'completed', waiting: true });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'waiting-for-github', deadline: 7100100 },
  });
  job.change({ now: 3600101 });
  await job.status();
  expect(job.sends()).toBe(3);
});

it('parks an actual question without accepting its completed-looking receipt or advancing the stage', async () => {
  const job = await stagesFixture();
  job.change({
    status: 'waiting-for-input',
    question: { id: 'q-1', text: 'Which approved option?' },
  });
  expect(await job.start()).toMatchObject({
    delivery: {
      stage: 'implementation',
      activity: 'awaiting-answer',
      active: false,
      ready: false,
      question: { id: 'q-1', text: 'Which approved option?' },
    },
  });
  expect(await job.status()).toMatchObject({
    delivery: {
      stage: 'implementation',
      activity: 'awaiting-answer',
      active: false,
      question: { id: 'q-1' },
    },
  });
  expect(job.sends()).toBe(0);
});
it('requires explicit resumption after a cleared question and never sends twice for competing commands', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q', text: 'Choose?' },
  });
  const started = await job.start();
  if (started.kind !== 'job') throw new Error('Expected reserved job');
  job.change({ status: 'completed', accepted: false });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'awaiting-answer', active: false },
  });
  const command = { jobId: started.intent.id, index: 0, questionId: 'q' };
  await Promise.all([job.resume(command), job.resume(command)]);
  expect(job.sends()).toBe(1);
  expect(await Effect.runPromise(job.store.readStage(1))).toMatchObject({
    stage: 'implementation',
    resume: true,
    ordinal: 2,
  });
  expect(await job.start()).toEqual({ kind: 'occupied' });
});
it('cancels explicitly without reopening admission or delivering a later stage', async () => {
  const job = await stagesFixture();
  job.change({ accepted: false });
  const started = await job.start();
  if (started.kind !== 'job') throw new Error('Expected job');
  expect(await job.cancel(started.intent.id)).toMatchObject({
    delivery: { activity: 'cancelled', active: false },
  });
  expect(job.interrupts()).toBe(1);
  job.change({ accepted: true });
  await job.status();
  expect(job.sends()).toBe(0);
  expect(await job.start()).toEqual({ kind: 'occupied' });
});
it.each(['interrupted', 'running', 'waiting-for-input'])(
  'does not accept a receipt while its structured run is %s',
  async (status) => {
    const job = await stagesFixture();
    job.change({ status });
    expect(await job.start()).toMatchObject({
      delivery: { stage: 'implementation', ready: false },
    });
    expect(job.sends()).toBe(0);
  }
);
it('rejects resumption while unanswered and rejects stale question commands after replacement', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q1', text: 'First?' },
  });
  const started = await job.start();
  if (started.kind !== 'job') throw new Error('Expected job');
  const command = { jobId: started.intent.id, index: 0, questionId: 'q1' };
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  job.change({ question: { id: 'q2', text: 'Replacement?' } });
  await job.status();
  job.change({ status: 'completed', accepted: true });
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'awaiting-answer', ready: false },
  });
  expect(job.sends()).toBe(0);
});
it('observes an answered live run without starting its stage again', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q', text: 'Choose?' },
  });
  await job.start();
  job.change({ status: 'running', answeredQuestions: ['q'] });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'implementation', active: true } });
  expect(job.sends()).toBe(0);
  job.change({ status: 'completed', accepted: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review' } });
  expect(job.sends()).toBe(1);
});
it('adopts the owning answered thread run and never issues a duplicate explicit resume', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q', text: 'Choose?' },
  });
  const initial = await job.start();
  if (initial.kind !== 'job') throw new Error('Expected job');
  job.change({ status: 'running', answeredQuestions: ['q'], runId: 'answer-run', ordinal: 2 });
  await job.resume({ jobId: initial.intent.id, index: 0, questionId: 'q' });
  await job.status();
  expect(job.sends()).toBe(0);
  expect(await Effect.runPromise(job.store.readStage(1))).toMatchObject({
    stage: 'implementation',
    observedRunId: 'answer-run',
    ordinal: 2,
  });
});
it('does not adopt a replacement run at the parked ordinal as an answer continuation', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q', text: 'Choose?' },
  });
  await job.start();
  job.change({
    status: 'completed',
    answeredQuestions: ['q'],
    runId: 'replacement',
    ordinal: 1,
    accepted: true,
  });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'awaiting-answer', ready: false },
  });
  expect(job.sends()).toBe(0);
});
it('retains the question association while an answered async continuation is not visible yet', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q', text: 'Choose?' },
  });
  await job.start();
  job.change({ status: 'completed', answeredQuestions: ['q'], accepted: false });
  await job.status();
  job.change({ status: 'running', runId: 'answer-run', ordinal: 2 });
  await job.status();
  expect(await Effect.runPromise(job.store.readStage(1))).toMatchObject({
    observedRunId: 'answer-run',
    ordinal: 2,
  });
  expect(job.sends()).toBe(0);
});
async function answeredBabysitting() {
  const job = await waitingJob();
  job.change({
    status: 'waiting-for-input',
    waiting: false,
    question: { id: 'repair-q', text: 'Which repair?' },
  });
  await job.status();
  job.change({ status: 'running', runId: 'answer-5', ordinal: 5, answeredQuestions: ['repair-q'] });
  await job.status();
  job.change({ status: 'completed', waiting: true, stageIndex: 5 });
  await job.status();
  return job;
}
it('sends the watchdog continuation once after adopting an answered babysitting run', async () => {
  const job = await answeredBabysitting();
  job.change({ now: 3600101 });
  await job.status();
  await job.status();
  expect(job.sends()).toBe(4);
  expect(await Effect.runPromise(job.store.readStage(6))).toMatchObject({
    stage: 'babysitting',
    continuation: true,
    ordinal: 6,
    previousRunId: 'answer-5',
  });
});
it('accepts an associated watcher completion after adopting a babysitting answer', async () => {
  const job = await answeredBabysitting();
  job.change({
    status: 'completed',
    waiting: false,
    accepted: true,
    runId: 'watcher-6',
    ordinal: 6,
    stageIndex: 5,
  });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review' } });
  expect(job.sends()).toBe(4);
});
it('retains the answer continuation when it asks another question before observation', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q1', text: 'First?' },
  });
  await job.start();
  job.change({
    answeredQuestions: ['q1'],
    runId: 'answer-2',
    ordinal: 2,
    question: { id: 'q2', text: 'Second?' },
  });
  expect(await job.status()).toMatchObject({
    delivery: { activity: 'awaiting-answer', active: false, question: { id: 'q2' } },
  });
  job.change({ answeredQuestions: ['q1', 'q2'], status: 'completed', accepted: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review' } });
  expect(job.sends()).toBe(1);
});
it('recovers the question recorded with an adopted run before control publication', async () => {
  const job = await stagesFixture();
  job.change({
    accepted: false,
    status: 'waiting-for-input',
    question: { id: 'q1', text: 'First?' },
  });
  await job.start();
  const original = await Effect.runPromise(job.store.readStage(0));
  if (!original) throw new Error('Expected original stage');
  await Effect.runPromise(
    job.store.saveStage({
      ...original,
      index: 1,
      ordinal: 2,
      previousRunId: 'run-1',
      observedRunId: 'answer-2',
      deliveryIndex: 0,
      question: { id: 'q2', text: 'Second?' },
    })
  );
  job.change({ status: 'running', answeredQuestions: ['q1', 'q2'], runId: 'answer-3', ordinal: 3 });
  await job.status();
  expect(await Effect.runPromise(job.store.readStage(2))).toMatchObject({
    stage: 'implementation',
    observedRunId: 'answer-3',
    ordinal: 3,
  });
  expect(job.sends()).toBe(0);
});

it('retains original review provenance and current CI binding after a verified issue-only replay', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({ prCommit: 'c'.repeat(40), reviewedCommit: 'b'.repeat(40) });
  expect(await job.status()).toMatchObject({
    delivery: { ready: true, commit: 'c'.repeat(40), reviewedCommit: 'b'.repeat(40) },
  });
  expect(job.sends()).toBe(2);
  job.change({ failed: true });
  expect(await job.status()).toMatchObject({ delivery: { ready: false } });
  expect(job.sends()).toBe(3);
});

it('rejects a replay association that does not bind the actually accepted original review', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({ prCommit: 'c'.repeat(40), reviewedCommit: 'd'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { ready: false } });
});

it('counts expected replay CI as active and parks external manual recovery without accepting either as ready', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  expect(await job.status()).toMatchObject({ delivery: { ready: true } });
  job.change({ prCommit: 'c'.repeat(40), maintenancePending: true });
  expect(await job.status()).toMatchObject({
    delivery: { ready: false, active: true, pr: { maintenancePending: true } },
  });
  job.change({ maintenancePending: false, reviewedCommit: 'b'.repeat(40) });
  expect(await job.status()).toMatchObject({
    delivery: { ready: true, reviewedCommit: 'b'.repeat(40) },
  });
  job.change({ manualRecovery: true });
  expect(await job.status()).toMatchObject({
    delivery: { ready: false, active: false, activity: 'manual-recovery' },
  });
  expect(job.sends()).toBe(2);
});

it.each([false, true])(
  'repairs owned replay CI once with maintenance pending %s',
  async (maintenancePending) => {
    const job = await stagesFixture();
    await job.start();
    await job.status();
    await job.status();
    job.change({
      prCommit: 'c'.repeat(40),
      reviewedCommit: 'b'.repeat(40),
      owningHeads: ['b'.repeat(40), 'd'.repeat(40)],
      maintenancePending,
      failed: true,
    });
    expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
    expect(await Effect.runPromise(job.store.readStage(4))).toMatchObject({
      commit: 'c'.repeat(40),
      comparison: {
        base: 'e'.repeat(40),
        prBase: 'D',
        previousHead: 'b'.repeat(40),
        owningHeads: ['b'.repeat(40), 'd'.repeat(40)],
      },
    });
    job.change({ accepted: false });
    await job.status();
    await job.status();
    expect(job.sends()).toBe(3);
  }
);

it('waits for replay writer ownership without consuming a repair delivery', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({
    prCommit: 'c'.repeat(40),
    reviewedCommit: 'b'.repeat(40),
    maintenancePending: true,
    failed: true,
    repairAllowed: false,
  });
  await job.status();
  await job.status();
  expect(job.sends()).toBe(2);
  job.change({ repairAllowed: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(job.sends()).toBe(3);
});

it('keeps repaired replay maintenance incomplete through fresh review and publication', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({
    prCommit: 'c'.repeat(40),
    reviewedCommit: 'b'.repeat(40),
    maintenancePending: true,
    failed: true,
  });
  await job.status();
  job.change({
    commit: 'd'.repeat(40),
    prCommit: 'd'.repeat(40),
    failed: false,
    repairAllowed: false,
  });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(job.sends()).toBe(3);
  job.change({ repairAllowed: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  expect(await Effect.runPromise(job.store.readStage(5))).toMatchObject({
    commit: 'd'.repeat(40),
    comparison: { base: 'e'.repeat(40), prBase: 'D' },
  });
  job.change({ repairAllowed: false });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'publication', ready: false } });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'ci', ready: false } });
  job.change({ maintenancePending: false });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'ci', ready: true, reviewedCommit: 'b'.repeat(40) },
  });
});
it('repairs a retained ready replay when the old publication receipt no longer matches the owning worktree', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({ prCommit: 'c'.repeat(40), reviewedCommit: 'b'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { ready: true } });
  job.change({ commit: 'c'.repeat(40), failed: true, runId: 'latest-owner-run', ordinal: 9 });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(job.sends()).toBe(3);
});

it('binds a retained replay repair to the latest idle owner run', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({ prCommit: 'c'.repeat(40), reviewedCommit: 'b'.repeat(40) });
  await job.status();
  job.change({ commit: 'c'.repeat(40), failed: true, runId: 'owner-9', ordinal: 9 });
  await job.status();
  expect(await Effect.runPromise(job.store.readStage(4))).toMatchObject({
    ordinal: 10,
    previousRunId: 'owner-9',
  });
});

it('repairs a failure observed immediately after the original publication receipt', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change({ failed: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'babysitting', ready: false } });
  expect(await Effect.runPromise(job.store.readStage(4))).toMatchObject({
    ordinal: 4,
    previousRunId: 'run-3',
  });
  expect(job.sends()).toBe(3);
});

it('retains review and publication authority after a replay repair correction', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  await job.status();
  job.change({
    prCommit: 'c'.repeat(40),
    reviewedCommit: 'b'.repeat(40),
    failed: true,
    maintenancePending: true,
  });
  await job.status();
  job.change({ commit: 'd'.repeat(40), prCommit: 'd'.repeat(40), failed: false });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
  job.change({ commit: 'f'.repeat(40), repairAllowed: false });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'review', ready: false, active: false },
  });
  await job.status();
  expect(job.sends()).toBe(4);
  job.change({ repairAllowed: true });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'publication', commit: 'f'.repeat(40), ready: false },
  });
  expect(job.repairs().at(-1)).toMatchObject({
    head: 'd'.repeat(40),
    repaired: 'f'.repeat(40),
    authority: {
      request: { stage: 'review', commit: 'd'.repeat(40) },
      evidence: { commit: 'f'.repeat(40), accepted: true },
    },
  });
  job.change({ prCommit: 'f'.repeat(40), repairAllowed: false });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'publication', ready: false, active: false },
  });
  await job.status();
  expect(job.sends()).toBe(5);
  job.change({ repairAllowed: true });
  expect(await job.status()).toMatchObject({ delivery: { stage: 'ci', ready: false } });
  expect(job.repairs().at(-1)).toMatchObject({
    head: 'f'.repeat(40),
    repaired: 'f'.repeat(40),
    authority: {
      request: {
        stage: 'publication',
        commit: 'f'.repeat(40),
        comparison: { previousHead: 'd'.repeat(40) },
      },
      evidence: { commit: 'f'.repeat(40), accepted: true },
    },
  });
  job.change({ maintenancePending: false });
  expect(await job.status()).toMatchObject({
    delivery: { ready: true, reviewedCommit: 'b'.repeat(40) },
  });
});

it.each([false, true])(
  'retries a pending reviewed publication only with its current writer claim: %s',
  async (allowed) => {
    const job = await stagesFixture();
    await job.start();
    await job.status();
    await job.status();
    job.change({
      prCommit: 'c'.repeat(40),
      reviewedCommit: 'b'.repeat(40),
      failed: true,
      maintenancePending: true,
    });
    await job.status();
    job.change({ commit: 'd'.repeat(40), prCommit: 'd'.repeat(40), failed: false });
    await job.status();
    job.change({ commit: 'f'.repeat(40) });
    expect(await job.status()).toMatchObject({ delivery: { stage: 'publication' } });
    job.change({
      accepted: false,
      status: 'interrupted',
      publicationRetryAllowed: allowed,
    });
    const before = await job.status();
    if (before.kind !== 'job') throw new Error('Missing retained job');
    expect(Boolean(before.resume)).toBe(allowed);
    expect(job.publicationRetries().at(-1)).toMatchObject({
      request: {
        stage: 'publication',
        commit: 'f'.repeat(40),
        comparison: { previousHead: 'd'.repeat(40) },
      },
      evidence: { accepted: false, commit: 'f'.repeat(40) },
    });
    if (allowed) {
      if (!before.resume) throw new Error('Missing retry');
      const sends = job.sends();
      const command = { jobId: before.intent.id, ...before.resume };
      expect(await job.resume(command)).toMatchObject({
        delivery: { stage: 'publication', ready: false },
      });
      expect(job.sends()).toBe(sends + 1);
      expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    }
  }
);

it.each(['status', 'tick'] as const)(
  'reacquires a deferred replay continuation slot through scheduler %s',
  async (method) => {
    let authorize: ContinuationAdmission['authorize'] = () => Effect.succeed(false);
    const job = await stagesFixture({ authorize: (issue, receipt) => authorize(issue, receipt) });
    await job.start();
    await job.status();
    await job.status();
    job.change({
      prCommit: 'c'.repeat(40),
      reviewedCommit: 'b'.repeat(40),
      maintenancePending: true,
      failed: true,
    });
    await job.status();
    job.change({
      commit: 'd'.repeat(40),
      prCommit: 'd'.repeat(40),
      failed: false,
      repairAllowed: false,
    });
    expect(await job.status()).toMatchObject({ delivery: { active: false, stage: 'babysitting' } });
    const schedule = controlledScheduleStore();
    await Effect.runPromise(
      schedule.save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: true,
        admissions: [
          { issue: 577, base: 'a'.repeat(40), context: '' },
          { issue: 99, base: 'a'.repeat(40), context: '' },
        ],
      })
    );
    const own = await job.status();
    if (own.kind !== 'job') throw new Error('Missing job');
    let occupied = true;
    const runtime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ScheduleStore, schedule),
            Layer.succeed(JobPool, {
              job: (issue) =>
                Effect.succeed(
                  issue === 577
                    ? {
                        status: () =>
                          Effect.promise(async () => {
                            const value = await job.status();
                            if (value.kind !== 'job' && value.kind !== 'empty')
                              throw new Error('Unexpected status');
                            return value;
                          }),
                        start: () => Effect.die('No new admission'),
                        resume: () => Effect.succeed({ kind: 'rejected' as const }),
                        cancel: () => Effect.succeed({ kind: 'rejected' as const }),
                      }
                    : {
                        status: () =>
                          Effect.succeed({
                            ...own,
                            intent: { ...own.intent, issue: 99, id: 'other' },
                            delivery: {
                              stage: 'implementation' as const,
                              commit: 'a'.repeat(40),
                              ready: !occupied,
                              landed: false,
                              active: occupied,
                            },
                          }),
                        start: () => Effect.die('No launch'),
                        resume: () => Effect.succeed({ kind: 'rejected' as const }),
                        cancel: () => Effect.succeed({ kind: 'rejected' as const }),
                      }
                ),
            }),
            Layer.succeed(Issues, {
              inspect: () => Effect.die('No issue admission'),
              pullRequest: () => Effect.die('No PR admission'),
            }),
            Layer.succeed(Plan, { preview: () => Effect.die('Paused: no planning') }),
            Layer.succeed(PlanningSource, { read: () => Effect.die('Paused: no discovery') })
          )
        )
      )
    );
    try {
      const scheduler = await runtime.runPromise(Scheduler);
      authorize = (issue, receipt) =>
        scheduler.authorizeRecovery(issue, receipt).pipe(
          Effect.tap((allowed) =>
            Effect.gen(function* () {
              if (!allowed) return;
              const state = yield* schedule.read();
              expect(state.resuming).toContainEqual(
                expect.objectContaining({ issue, index: receipt.index, run: receipt.run })
              );
            })
          )
        );
      job.change({ repairAllowed: true, runningAfterSend: true });
      const observe = () =>
        runtime.runPromise(
          method === 'status' ? scheduler.status() : scheduler.tick('a'.repeat(40))
        );
      await observe();
      await observe();
      expect(job.sends()).toBe(3);
      expect(await Effect.runPromise(job.store.readStage(5))).toBeNull();
      occupied = false;
      const configured = authorize;
      // Keep the observed job deferred while directly testing invalid authority
      // against otherwise free scheduler capacity.
      authorize = () => Effect.succeed(false);
      const receipt = { threadId: 'thread', index: 4, run: { id: 'run-4', ordinal: 4 } };
      expect(await runtime.runPromise(scheduler.authorizeRecovery(999, receipt))).toBe(false);
      expect(
        await runtime.runPromise(
          scheduler.authorizeRecovery(577, { ...receipt, threadId: 'other' })
        )
      ).toBe(false);
      expect(
        await runtime.runPromise(
          scheduler.authorizeRecovery(577, { ...receipt, run: { id: 'stale', ordinal: 4 } })
        )
      ).toBe(false);
      expect(
        await runtime.runPromise(
          scheduler.authorizeRecovery(577, { ...receipt, run: { id: 'run-4', ordinal: 3 } })
        )
      ).toBe(false);
      expect((await Effect.runPromise(schedule.read())).resuming ?? []).toEqual([]);
      expect(job.sends()).toBe(3);
      authorize = configured;
      await observe();
      expect(job.sends()).toBe(4);
      expect(await Effect.runPromise(job.store.readStage(5))).toMatchObject({
        stage: 'review',
        commit: 'd'.repeat(40),
        previousRunId: 'run-4',
      });
      job.change({ accepted: false });
      await observe();
      await observe();
      expect(job.sends()).toBe(4);
      expect((await Effect.runPromise(schedule.read())).admissions).toHaveLength(2);
    } finally {
      await runtime.dispose();
    }
  }
);

it('keeps a questioned replay receipt inactive without requesting continuation capacity', async () => {
  let requests = 0;
  const job = await stagesFixture({
    authorize: () =>
      Effect.sync(() => {
        requests++;
        return true;
      }),
  });
  await job.start();
  await job.status();
  await job.status();
  job.change({
    prCommit: 'c'.repeat(40),
    reviewedCommit: 'b'.repeat(40),
    maintenancePending: true,
    failed: true,
  });
  await job.status();
  job.change({
    commit: 'd'.repeat(40),
    prCommit: 'd'.repeat(40),
    failed: false,
    repairAllowed: false,
  });
  await job.status();
  job.change({ repairAllowed: true, question: { id: 'hold', text: 'Operator answer required' } });
  expect(await job.status()).toMatchObject({
    delivery: { active: false, activity: 'awaiting-answer', stage: 'babysitting' },
  });
  expect(requests).toBe(0);
  expect(job.sends()).toBe(3);
});

it.each(['interrupted', 'failed'])(
  'explicitly retries a verified %s implementation without accepting it',
  async (status) => {
    const job = await stagesFixture();
    job.change({ status, accepted: false });
    const before = await job.start();
    if (before.kind !== 'job') throw new Error('Expected job');
    expect(before.resume).toMatchObject({ index: 0, runId: 'run-1', revision: -1 });
    if (!before.resume) throw new Error('Expected retry command');
    const command = { jobId: before.intent.id, ...before.resume };
    await job.resume(command);
    const after = await job.status();
    expect(after).toMatchObject({
      intent: before.intent,
      delivery: { stage: 'implementation', ready: false },
      execution: { run: { id: 'run-2', ordinal: 2 } },
    });
    expect(job.sends()).toBe(1);
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    expect(job.sends()).toBe(1);
    job.change({ accepted: true, status: 'completed' });
    expect(await job.status()).toMatchObject({ delivery: { stage: 'review', ready: false } });
    expect(job.sends()).toBe(2);
  }
);

it('retries a failed review in the existing stage without reopening implementation', async () => {
  const job = await stagesFixture();
  await job.start();
  job.change({ accepted: false, status: 'failed' });
  const before = await job.status();
  if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
  expect(before.resume).toMatchObject({ index: 1, runId: 'run-2' });
  await job.resume({ jobId: before.intent.id, ...before.resume });
  expect(await job.status()).toMatchObject({
    intent: before.intent,
    delivery: { stage: 'review', ready: false },
    execution: { run: { id: 'run-3', ordinal: 3 } },
  });
  expect(job.sends()).toBe(2);
});
it.each(['running', 'waiting-for-input', 'cancelled', 'completed'])(
  'rejects stale retry after status changes to %s',
  async (status) => {
    const job = await stagesFixture();
    job.change({ status: 'interrupted', accepted: false });
    const before = await job.start();
    if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
    job.change({ status });
    expect(await job.resume({ jobId: before.intent.id, ...before.resume })).toEqual({
      kind: 'rejected',
    });
    expect(job.sends()).toBe(0);
  }
);
it('rejects stale job, stage, run and control revisions and unanswered questions', async () => {
  const job = await stagesFixture();
  job.change({ status: 'failed', accepted: false });
  const before = await job.start();
  if (before.kind !== 'job' || !before.resume || !('runId' in before.resume))
    throw new Error('Expected retry');
  const command = { jobId: before.intent.id, ...before.resume };
  for (const patch of [{ jobId: 'other' }, { index: 1 }, { runId: 'old' }, { revision: 42 }]) {
    expect(await job.resume({ ...command, ...patch })).toEqual({ kind: 'rejected' });
  }
  job.change({ question: { id: 'unanswered', text: 'Answer?' } });
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  expect(job.sends()).toBe(0);
  await job.cancel(before.intent.id);
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
});

it('keeps uncertain retry delivery pending across fresh runtimes and rejects unverified runs', async () => {
  const job = await stagesFixture();
  job.change({ accepted: false, status: 'interrupted' });
  const before = await job.start();
  if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
  const command = { jobId: before.intent.id, ...before.resume };
  job.change({ ambiguous: true });
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  job.change({ ambiguous: false, missingEvidence: true });
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  job.change({ missingEvidence: false, loseSend: true });
  await expect(job.resume(command)).rejects.toMatchObject({
    _tag: 'Unavailable',
    operation: 'lost-send',
  });
  job.change({ loseSend: false });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'implementation', ready: false },
    resume: undefined,
  });
  expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  expect(job.sends()).toBe(1);
});

async function terminalDeliveryFixture(stage: 'publication' | 'babysitting', status = 'failed') {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  if (stage === 'babysitting') {
    job.change({ failed: true });
    await job.status();
  }
  job.change({ accepted: false, status });
  return job;
}
it.each([
  ['publication', 'failed'],
  ['publication', 'interrupted'],
  ['babysitting', 'failed'],
  ['babysitting', 'interrupted'],
] as const)(
  'retries the verified terminal %s run when %s without another job',
  async (stage, status) => {
    const job = await terminalDeliveryFixture(stage, status);
    const before = await job.status();
    if (before.kind !== 'job') throw new Error('Expected job');
    expect(before.resume).toMatchObject({
      index: stage === 'publication' ? 2 : 4,
      runId: stage === 'publication' ? 'run-3' : 'run-4',
    });
    if (!before.resume) throw new Error('Expected retry');
    const command = { jobId: before.intent.id, ...before.resume };
    const sends = job.sends();
    await job.resume(command);
    expect(await job.status()).toMatchObject({
      intent: before.intent,
      delivery: { stage, ready: false },
      execution: { run: { ordinal: stage === 'publication' ? 4 : 5 } },
    });
    expect(job.sends()).toBe(sends + 1);
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    expect(job.sends()).toBe(sends + 1);
  }
);

it('reconciles externally successful CI after terminal babysitting before considering retry', async () => {
  const job = await terminalDeliveryFixture('babysitting');
  const before = await job.status();
  if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
  const sends = job.sends();
  job.change({ failed: false });
  expect(await job.status()).toMatchObject({
    resume: undefined,
    delivery: { stage: 'ci', ready: true },
  });
  expect(await job.resume({ jobId: before.intent.id, ...before.resume })).toEqual({
    kind: 'rejected',
  });
  expect(job.sends()).toBe(sends);
});

it.each(['publication', 'babysitting'] as const)(
  'blocks unsafe %s retry states and retains uncertain delivery claims',
  async (stage) => {
    const job = await terminalDeliveryFixture(stage);
    const initial = await job.status();
    if (initial.kind !== 'job' || !initial.resume || !('runId' in initial.resume))
      throw new Error('Expected retry');
    const command = { jobId: initial.intent.id, ...initial.resume };
    const sends = job.sends();
    for (const patch of [{ jobId: 'other' }, { index: 99 }, { runId: 'stale' }, { revision: 99 }])
      expect(await job.resume({ ...command, ...patch })).toEqual({ kind: 'rejected' });
    job.change({ runId: 'unknown-owner-run' });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ runId: command.runId, ordinal: 99 });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ ordinal: stage === 'publication' ? 3 : 4 });
    if (stage === 'publication') {
      job.change({ worktreeClean: false });
      expect(await job.resume(command)).toEqual({ kind: 'rejected' });
      job.change({ worktreeClean: true });
    }
    for (const status of ['running', 'cancelled', 'completed', 'waiting-for-input']) {
      job.change({ status });
      expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    }
    job.change({ status: 'failed', prKind: 'ambiguous' });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ prKind: 'found', prCommit: 'f'.repeat(40) });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ prCommit: 'b'.repeat(40), missingEvidence: true });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ missingEvidence: false, ambiguous: true });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ ambiguous: false, manualRecovery: true });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ manualRecovery: false, maintenancePending: true });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    job.change({ maintenancePending: false, loseSend: true });
    await expect(job.resume(command)).rejects.toMatchObject({ _tag: 'Unavailable' });
    job.change({ loseSend: false });
    expect(await job.status()).toMatchObject({ resume: undefined, delivery: { ready: false } });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    expect(job.sends()).toBe(sends + 1);
    await job.cancel(initial.intent.id);
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
  }
);
it('allows a publication proven absent but keeps babysitting pending when its PR is missing', async () => {
  for (const stage of ['publication', 'babysitting'] as const) {
    const job = await terminalDeliveryFixture(stage);
    job.change({ prKind: 'absent' });
    const result = await job.status();
    if (result.kind !== 'job') throw new Error('Expected job');
    expect(Boolean(result.resume)).toBe(stage === 'publication');
  }
});
it('does not accept externally successful publication without a receipt, and reconciles its eventual receipt without resending', async () => {
  const job = await terminalDeliveryFixture('publication');
  const before = await job.status();
  if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
  expect(before.delivery?.ready).toBe(false);
  const sends = job.sends();
  job.change({ status: 'completed', accepted: true });
  expect(await job.resume({ jobId: before.intent.id, ...before.resume })).toEqual({
    kind: 'rejected',
  });
  expect(await job.status()).toMatchObject({
    resume: undefined,
    delivery: { stage: 'ci', ready: true },
  });
  expect(job.sends()).toBe(sends);
});
it('never treats missing or conflicting terminal run proof as successful CI reconciliation', async () => {
  const job = await terminalDeliveryFixture('babysitting');
  await job.status();
  job.change({ failed: false, missingEvidence: true });
  expect(await job.status()).toMatchObject({ resume: undefined, delivery: { ready: false } });
  job.change({ missingEvidence: false, runId: 'unknown-run' });
  expect(await job.status()).toMatchObject({ resume: undefined, delivery: { ready: false } });
});

it('preserves existing watchdog deadlines and nudge claims during explicit terminal babysitter retry', async () => {
  const job = await terminalDeliveryFixture('babysitting');
  const before = await job.status();
  if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
  const wait = { revision: 0, progress: 'same checks', deadline: 3600100, nudged: true };
  expect(await Effect.runPromise(job.store.saveWait(wait))).toBe(true);
  const sends = job.sends();
  await job.resume({ jobId: before.intent.id, ...before.resume });
  await job.status();
  expect(await Effect.runPromise(job.store.readWait())).toEqual(wait);
  expect(job.sends()).toBe(sends + 1);
});
it.each(['publication', 'babysitting'] as const)(
  'does not retry %s through an unanswered question or factory cancellation',
  async (stage) => {
    const job = await terminalDeliveryFixture(stage);
    const before = await job.status();
    if (before.kind !== 'job' || !before.resume) throw new Error('Expected retry');
    const sends = job.sends();
    const command = { jobId: before.intent.id, ...before.resume };
    job.change({ question: { id: 'pending', text: 'Decide?' } });
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    await job.cancel(before.intent.id);
    expect(await job.resume(command)).toEqual({ kind: 'rejected' });
    expect(job.sends()).toBe(sends);
  }
);

it('does not reconcile successful CI over unfinished or unreviewed babysitter work', async () => {
  const job = await terminalDeliveryFixture('babysitting');
  await job.status();
  job.change({ failed: false, worktreeClean: false });
  expect(await job.status()).toMatchObject({ delivery: { ready: false } });
  job.change({ worktreeClean: true, commit: 'c'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { ready: false } });
  job.change({ commit: 'b'.repeat(40) });
  expect(await job.status()).toMatchObject({ delivery: { ready: true } });
});

it('does not use an older publication acceptance to declare replayed babysitter code ready', async () => {
  const job = await stagesFixture();
  await job.start();
  await job.status();
  job.change({ failed: true, reviewedCommit: 'b'.repeat(40), prCommit: 'd'.repeat(40) });
  await job.status();
  job.change({ accepted: false, status: 'failed', failed: false, commit: 'd'.repeat(40) });
  expect(await job.status()).toMatchObject({
    delivery: { stage: 'babysitting', ready: false },
    resume: { runId: 'run-4' },
  });
});
