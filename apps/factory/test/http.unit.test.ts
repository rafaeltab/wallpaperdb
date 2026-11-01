import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
import {
  Unavailable,
  type Job,
  type Start,
  type Intent,
  type Status,
  type StartResult,
} from '../src/capabilities/job/index.js';
const idle: Job = {
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
const startRequest = {
  method: 'POST' as const,
  url: '/api/job',
  payload: { issue: 576, context: 'Read only' },
};
it('reports HTTP health', () =>
  contract(async (app) => {
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
  }));
it('translates an empty job status', () =>
  contract(async (app) => {
    expect((await app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
  }));
it('presents deliberate selection when no job is admitted', () =>
  contract(async (app) => {
    expect((await app.inject('/')).body).toContain('Selected issue number');
  }));
it('translates a selected issue and context using the server-owned base', async () => {
  let received: Start | null = null;
  const result: StartResult = { kind: 'job', intent, execution: { kind: 'absent' }, elapsedMs: 0 };
  await contract(
    async (app) => {
      const response = await app.inject(startRequest);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual(result);
      expect(received).toEqual({ issue: 576, context: 'Read only', base: 'a'.repeat(40) });
    },
    {
      ...idle,
      start: (command) => {
        received = command;
        return Effect.succeed(result);
      },
    }
  );
});
it.each([
  ['occupied', 409],
  ['rejected', 422],
] as const)('translates %s into Problem Details', async (kind, status) => {
  await contract(
    async (app) => {
      const response = await app.inject(startRequest);
      expect(response.statusCode).toBe(status);
      expect(response.headers['content-type']).toContain('application/problem+json');
    },
    { ...idle, start: () => Effect.succeed({ kind }) }
  );
});
it.each([{ issue: 0 }, { issue: 576, base: 'evil' }])(
  'rejects invalid command data %j',
  (payload) =>
    contract(async (app) => {
      expect((await app.inject({ method: 'POST', url: '/api/job', payload })).statusCode).toBe(400);
    })
);
it('rejects a foreign browser origin', () =>
  contract(async (app) => {
    expect(
      (await app.inject({ ...startRequest, headers: { origin: 'https://evil.test' } })).statusCode
    ).toBe(403);
  }));
it.each(['absent', 'ambiguous'] as const)(
  'presents a reserved job with %s execution evidence',
  (kind) => {
    const current: Status = { kind: 'job', intent, execution: { kind }, elapsedMs: 42000 };
    return contract(
      async (app) => {
        const rendered = (await app.inject('/')).body;
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
      const rendered = (await app.inject('/')).body;
      expect(rendered).toContain('Elapsed: 42 seconds');
      expect(rendered).not.toContain('<form>');
      expect(rendered).not.toContain('<script>unsafe</script>');
      expect(rendered).toContain('t3-thread://v1/thread-1');
      expect(rendered).toContain('does not establish implementation acceptance');
    },
    { ...idle, status: () => Effect.succeed(current) }
  );
});
it('rejects unsupported media types', () =>
  contract(async (app) => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/job',
          headers: { 'content-type': 'text/plain' },
          payload: 'hello',
        })
      ).statusCode
    ).toBe(415);
  }));
it('translates malformed JSON into a client error', () =>
  contract(async (app) => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/job',
          headers: { 'content-type': 'application/json' },
          payload: '{broken',
        })
      ).statusCode
    ).toBe(400);
  }));
it('translates technical failure without disclosing the cause', () =>
  contract(
    async (app) => {
      const response = await app.inject(startRequest);
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('secret');
    },
    {
      ...idle,
      start: () =>
        Effect.fail(new Unavailable({ operation: 'hidden', cause: new Error('secret') })),
    }
  ));
it('shows current commit PR readiness separately from default branch landing', () =>
  contract(
    async (app) => {
      const rendered = (await app.inject('/')).body;
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
it('translates explicit resume with its job and parked-stage identity', async () => {
  const commands: unknown[] = [];
  const command = { jobId: '1', index: 0, questionId: 'q' };
  await contract(
    async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/job/resume',
        payload: command,
      });
      expect(response.statusCode).toBe(202);
      expect(commands).toEqual([command]);
    },
    {
      ...idle,
      resume: (value) => {
        commands.push(value);
        return Effect.succeed({ kind: 'empty' });
      },
    }
  );
});
it('translates explicit cancellation and rejected commands without changing admission', async () => {
  const received: string[] = [];
  await contract(
    async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/job/cancel',
        payload: { jobId: '1' },
      });
      expect(response.statusCode).toBe(202);
      expect(received).toEqual(['1']);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/job/resume',
            payload: { jobId: '1', index: 0, questionId: 'q' },
          })
        ).statusCode
      ).toBe(409);
    },
    {
      ...idle,
      cancel: (id) => {
        received.push(id);
        return Effect.succeed({ kind: 'empty' });
      },
    }
  );
});
it.each(['/api/job/resume', '/api/job/cancel'])(
  'rejects invalid and foreign-origin commands at %s',
  async (url) => {
    await contract(async (app) => {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { origin: 'https://evil.test' },
            payload: {},
          })
        ).statusCode
      ).toBe(403);
    });
  }
);
it('renders the parked question safely with the owning thread and resume command', async () => {
  await contract(
    async (app) => {
      const rendered = (await app.inject('/')).body;
      expect(rendered).toContain('Active capacity released');
      expect(rendered).toContain('&lt;question&gt;');
      expect(rendered).toContain('t3-thread://v1/owning-thread');
      expect(rendered).toContain('disabled>Resume existing job');
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
    async (app) => expect((await app.inject('/')).body).not.toContain('>Cancel job<'),
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

it('translates plan preview and rejects foreign origins without invoking planning', async () => {
  let calls = 0;
  const result = {
    kind: 'preview' as const,
    selected: [],
    rejected: [{ issue: 580, reason: 'API unsettled' }],
    input: {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1 as const, admission: 1 as const },
    },
  };
  const app = operationsServer({
    base: 'a'.repeat(40),
    job: idle,
    run: Effect.runPromise,
    plan: {
      preview: () =>
        Effect.sync(() => {
          calls++;
          return result;
        }),
    },
  });
  try {
    expect((await app.inject({ method: 'POST', url: '/api/plan', payload: {} })).json()).toEqual(
      result
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/plan',
          payload: {},
          headers: { origin: 'https://evil.test' },
        })
      ).statusCode
    ).toBe(403);
    expect(calls).toBe(1);
  } finally {
    await app.close();
  }
});

it('translates scheduler controls including unlimited limits and stale revisions', async () => {
  const commands: unknown[] = [];
  const state = { revision: 4, concurrency: 1, allowance: 1, paused: true, admissions: [] };
  const app = operationsServer({
    base: 'a'.repeat(40),
    job: idle,
    run: Effect.runPromise,
    scheduler: {
      status: () => Effect.succeed({ state, jobs: [] }),
      configure: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return command.revision === 4 ? ('saved' as const) : ('conflict' as const);
        }),
      tick: () => Effect.succeed({ state, jobs: [] }),
      start: idle.start,
      resume: idle.resume,
      cancel: idle.cancel,
    },
  });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scheduler',
          payload: { revision: 4, concurrency: -1, allowance: -1, paused: false },
        })
      ).statusCode
    ).toBe(200);
    expect(commands).toEqual([{ revision: 4, concurrency: -1, allowance: -1, paused: false }]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scheduler',
          payload: { revision: 3, concurrency: 2, allowance: 3, paused: false },
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scheduler',
          payload: { revision: 4, concurrency: 0, allowance: 1, paused: false },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scheduler',
          headers: { origin: 'https://outside.invalid' },
          payload: { revision: 4, concurrency: 1, allowance: 1, paused: false },
        })
      ).statusCode
    ).toBe(403);
  } finally {
    await app.close();
  }
});

it('renders server-owned scheduler settings and all reserved jobs', async () => {
  const state = { revision: 4, concurrency: -1, allowance: 3, paused: true, admissions: [] };
  const job: Status = { kind: 'job', intent, execution: { kind: 'absent' }, elapsedMs: 0 };
  const app = operationsServer({
    base: intent.base,
    job: idle,
    run: Effect.runPromise,
    scheduler: {
      status: () => Effect.succeed({ state, jobs: [{ kind: 'empty' }, { kind: 'empty' }, job] }),
      configure: () => Effect.succeed('saved'),
      tick: () => Effect.succeed({ state, jobs: [] }),
      start: idle.start,
      resume: idle.resume,
      cancel: idle.cancel,
    },
  });
  try {
    const paused = await app.inject('/');
    expect(paused.body).toContain('Admissions paused.');
    expect(paused.body).toContain('value="-1"');
    expect(paused.body).toContain('Reserved admission awaiting reconciliation.');
    expect(paused.body).toContain('Issue #576');
    state.paused = false;
    expect((await app.inject('/')).body).toContain('Admissions enabled.');
  } finally {
    await app.close();
  }
});

it('translates a valid scheduler command rejected by the capability into 422 Problem Details', async () => {
  const state = { revision: 0, concurrency: 1, allowance: 1, paused: false, admissions: [] };
  const app = operationsServer({
    base: intent.base,
    job: idle,
    run: Effect.runPromise,
    scheduler: {
      status: () => Effect.succeed({ state, jobs: [] }),
      configure: () => Effect.succeed('rejected'),
      tick: () => Effect.succeed({ state, jobs: [] }),
      start: idle.start,
      resume: idle.resume,
      cancel: idle.cancel,
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler',
      payload: { revision: 0, concurrency: 2, allowance: -1, paused: false },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      status: 422,
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/factory-command.md',
      title: 'Controls changed or limits invalid. Refresh observation.',
    });
  } finally {
    await app.close();
  }
});
