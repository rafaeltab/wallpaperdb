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
  let interrupts = 0;
  let answeredQuestions: readonly string[] = [];
  let failed = false;
  let now = 100;
  let progress = 'run-1:failed';
  let waiting = false;
  let status = 'completed';
  let stageIndex: number | undefined;
  let question: { id: string; text: string } | undefined;
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
      interrupt: () =>
        Effect.sync(() => {
          interrupts++;
        }),
      launch: () => Effect.succeed({ kind: 'submitted' as const }),
      observe: (intent) =>
        Effect.succeed({
          kind: 'found' as const,
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
        Effect.succeed({
          runId,
          ordinal,
          commit,
          accepted,
          linked: links,
          waitingForGitHub: waiting,
          stageIndex,
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
    cancel: (id: string) => run((job) => job.cancel(id)),
    resume: (command: { jobId: string; index: number; questionId: string }) =>
      run((job) => job.resume(command)),
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
      stageIndex?: number;
      question?: { id: string; text: string };
      answeredQuestions?: readonly string[];
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
