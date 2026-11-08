import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../../src/http/index.js';
import type { Job, Intent, Status } from '../../src/capabilities/job/index.js';
const idle: Job = {
  retry: () => Effect.die('Unexpected fresh retry in this fixture'),
  resume: () => Effect.succeed({ kind: 'rejected' }),
  cancel: () => Effect.succeed({ kind: 'rejected' }),
  start: () => Effect.succeed({ kind: 'empty' }),
  status: () => Effect.succeed({ kind: 'empty' }),
};
const intent: Intent = {
  id: '1',
  issue: 576,
  issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
  base: 'a'.repeat(40),
  context: '',
  branch: 'factory/job-1',
  createdAt: 0,
  expectedStage: 'implementation',
};
async function contract(
  check: (app: ReturnType<typeof operationsServer>) => Promise<void>,
  job: Job = idle
) {
  const app = operationsServer({ base: 'a'.repeat(40), job, run: Effect.runPromise });
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
import { renderToStaticMarkup } from 'react-dom/server';
import { Work } from '../src/jobs';
import { SchedulerControls } from '../src/app';
import type { ScheduleSnapshot } from '../src/api';
async function renderPage(app: ReturnType<typeof operationsServer>) {
  const response = await app.inject('/api/scheduler');
  const snapshot: ScheduleSnapshot =
    response.statusCode === 200
      ? response.json()
      : {
          state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
          jobs: [(await app.inject('/api/job')).json()],
          localWork: [],
          observations: { state: 'initial', stale: true },
        };
  const command = async () => undefined;
  return {
    body: renderToStaticMarkup(
      <>
        <SchedulerControls snapshot={snapshot} command={command} pending={false} />
        <Work snapshot={snapshot} command={command} pending={false} />
      </>
    ),
  };
}
it.each(['absent', 'ambiguous'] as const)(
  'presents a reserved job with %s execution evidence',
  (kind) => {
    const current: Status = { kind: 'job', intent, execution: { kind }, elapsedMs: 42000 };
    return contract(
      async (app) => {
        const rendered = (await renderPage(app)).body;
        expect(rendered).toContain('Elapsed: 42 seconds');
        expect(rendered).not.toContain('<form>');
      },
      { ...idle, status: () => Effect.succeed(current) }
    );
  }
);
it('presents a completed worker safely without accepting implementation', () => {
  const current: Status = {
    kind: 'job',
    intent,
    execution: {
      kind: 'found',
      threadId: 'thread-1',
      status: 'completed',
      worktree: '<script>unsafe</script>',
      branch: 'factory/job-1',
      model: 'gpt-6.1-sol',
    },
    elapsedMs: 42000,
  };
  return contract(
    async (app) => {
      const rendered = (await renderPage(app)).body;
      expect(rendered).toContain('Elapsed: 42 seconds');
      expect(rendered).not.toContain('<form>');
      expect(rendered).not.toContain('<script>unsafe</script>');
      expect(rendered).toContain('T3 links unavailable');
      expect(rendered).toContain('does not establish implementation acceptance');
    },
    { ...idle, status: () => Effect.succeed(current) }
  );
});
it('shows current commit PR readiness separately from default branch landing', () =>
  contract(
    async (app) => {
      const rendered = (await renderPage(app)).body;
      expect(rendered).toContain('Ready for manual merge');
      expect(rendered).toContain('Not landed');
      expect(rendered).toContain('https://github.com/rafaeltab/wallpaperdb/pull/999');
      expect(rendered).toContain('b'.repeat(40));
    },
    {
      ...idle,
      status: () =>
        Effect.succeed({
          kind: 'job',
          intent,
          execution: { kind: 'absent' },
          elapsedMs: 0,
          delivery: {
            stage: 'ci',
            commit: 'b'.repeat(40),
            ready: true,
            landed: false,
            pr: {
              kind: 'found',
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
              commit: 'b'.repeat(40),
              ready: true,
              landed: false,
            },
          },
        }),
    }
  ));
it('renders the parked question safely with the owning thread and resume command', async () => {
  await contract(
    async (app) => {
      const rendered = (await renderPage(app)).body;
      expect(rendered).toContain('Active capacity released');
      expect(rendered).toContain('&lt;question&gt;');
      expect(rendered).toContain('T3 links unavailable');
      expect(rendered).toContain('disabled="">Resume existing job');
    },
    {
      ...idle,
      status: () =>
        Effect.succeed({
          kind: 'job',
          intent,
          elapsedMs: 0,
          execution: {
            kind: 'found',
            threadId: 'owning-thread',
            status: 'waiting-for-input',
            worktree: '/worker',
            branch: intent.branch,
            model: 'gpt-6.1-sol',
            question: { id: 'q', text: '<question>' },
          },
          resume: { index: 0, questionId: 'q' },
          delivery: {
            stage: 'implementation',
            commit: intent.base,
            ready: false,
            landed: false,
            active: false,
            activity: 'awaiting-answer',
            question: { id: 'q', text: '<question>' },
          },
        }),
    }
  );
});
it('hides cancellation after its durable command is accepted', async () => {
  await contract(
    async (app) => expect((await renderPage(app)).body).not.toContain('>Cancel job<'),
    {
      ...idle,
      status: () =>
        Effect.succeed({
          kind: 'job',
          intent,
          execution: { kind: 'absent' },
          elapsedMs: 0,
          delivery: {
            stage: 'implementation',
            commit: intent.base,
            ready: false,
            landed: false,
            active: false,
            activity: 'cancelled',
          },
        }),
    }
  );
});

it('renders server-owned scheduler settings and all reserved jobs', async () => {
  const state = { revision: 4, concurrency: -1, allowance: 3, paused: true, admissions: [] };
  const job: Status = { kind: 'job', intent, execution: { kind: 'absent' }, elapsedMs: 0 };
  const app = operationsServer({
    base: intent.base,
    job: idle,
    run: Effect.runPromise,
    scheduler: {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      authorizeRecovery: () => Effect.succeed(false),
      status: () => Effect.succeed({ state, jobs: [{ kind: 'empty' }, { kind: 'empty' }, job] }),
      configure: () => Effect.succeed('saved'),
      tick: () => Effect.succeed({ state, jobs: [] }),
      start: idle.start,
      resume: idle.resume,
      cancel: idle.cancel,
    },
  });
  try {
    const paused = await renderPage(app);
    expect(paused.body).toContain('Admissions paused.');
    expect(paused.body).toContain('value="-1"');
    expect(paused.body).toContain('Reserved admission awaiting reconciliation.');
    expect(paused.body).toContain('Issue #576');
    state.paused = false;
    expect((await renderPage(app)).body).toContain('Admissions enabled.');
  } finally {
    await app.close();
  }
});

it.each([false, true])(
  'renders recovery classification, progress and escaped questions, classified=%s',
  async (classified) => {
    const state = { revision: 0, concurrency: 1, allowance: 1, paused: false, admissions: [] };
    const app = operationsServer({
      base: intent.base,
      job: idle,
      run: Effect.runPromise,
      scheduler: {
        retry: () => Effect.die('Unexpected fresh retry in this fixture'),
        authorizeRecovery: () => Effect.succeed(false),
        status: () =>
          Effect.succeed({
            state,
            jobs: [],
            recoveries: [
              {
                issue: 584,
                pr: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
                classification: classified ? ('COMPLEX' as const) : undefined,
                progress: 'Awaiting independent review-loop',
                question: classified ? '<script>scope?</script>' : undefined,
                threadId: classified ? 'recovery-thread' : undefined,
              },
            ],
          }),
        configure: () => Effect.succeed('saved'),
        tick: () => Effect.succeed({ state, jobs: [] }),
        start: idle.start,
        resume: idle.resume,
        cancel: idle.cancel,
      },
    });
    try {
      const response = await renderPage(app);
      expect(response.body).toContain(`Classification: ${classified ? 'COMPLEX' : 'Unclassified'}`);
      expect(response.body).toContain('Awaiting independent review-loop');
      if (classified) {
        expect(response.body).toContain('Question: &lt;script&gt;scope?&lt;/script&gt;');
        expect(response.body).toContain('T3 links unavailable');
      }
    } finally {
      await app.close();
    }
  }
);
