import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
import {
  Unavailable,
  type Job,
  type Start,
  type Intent,
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
it.each([
  { jobId: '1', index: 0, questionId: 'q' },
  { jobId: '1', index: 0, runId: 'run-1', revision: -1 },
])('translates explicit resume identity %j', async (command) => {
  const commands: unknown[] = [];
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
      authorizeRecovery: () => Effect.succeed(false),
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

it('translates a valid scheduler command rejected by the capability into 422 Problem Details', async () => {
  const state = { revision: 0, concurrency: 1, allowance: 1, paused: false, admissions: [] };
  const app = operationsServer({
    base: intent.base,
    job: idle,
    run: Effect.runPromise,
    scheduler: {
      authorizeRecovery: () => Effect.succeed(false),
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

it.each([
  { jobId: '1', index: 0, runId: 'run' },
  { jobId: '1', index: 0, runId: 'run', revision: -2 },
  { jobId: '1', index: 0, runId: 'run', revision: 0, questionId: 'q' },
])('rejects malformed retry identity %j at HTTP boundary', async (command) => {
  let calls = 0;
  await contract(
    async (app) => {
      expect(
        (await app.inject({ method: 'POST', url: '/api/job/resume', payload: command })).statusCode
      ).toBe(400);
      expect(calls).toBe(0);
    },
    {
      ...idle,
      resume: () => {
        calls++;
        return Effect.succeed({ kind: 'rejected' });
      },
    }
  );
});

it('renders current dependency direction from the admitted issue read model and fails rather than retaining stale edges', async () => {
  const requested: (readonly number[])[] = [];
  let unavailable = false;
  let blockers = [1];
  const state = {
    revision: 4,
    concurrency: 1,
    allowance: 2,
    paused: true,
    admissions: [
      { issue: 2, base: intent.base, context: '' },
      { issue: 3, base: intent.base, context: '' },
    ],
  };
  const app = operationsServer({
    base: intent.base,
    job: idle,
    run: Effect.runPromise,
    relationships: (issues) => {
      requested.push(issues);
      return unavailable
        ? Effect.fail(
            new Unavailable({ operation: 'relationships', cause: new Error('private-cause') })
          )
        : Effect.succeed([
            { issue: 2, blockers },
            { issue: 3, blockers: [2] },
          ]);
    },
    scheduler: {
      authorizeRecovery: () => Effect.succeed(false),
      status: () => Effect.succeed({ state, jobs: [] }),
      tick: () => Effect.succeed({ state, jobs: [] }),
      configure: () => Effect.succeed('saved'),
      start: idle.start,
      resume: idle.resume,
      cancel: idle.cancel,
    },
  });
  try {
    const first = JSON.stringify((await app.inject('/api/scheduler')).json());
    expect(JSON.parse(first).relationships).toEqual([
      { issue: 2, blockers: [1] },
      { issue: 3, blockers: [2] },
    ]);
    expect(requested).toEqual([[2, 3]]);
    blockers = [];
    expect((await app.inject('/api/scheduler')).json().relationships[0].blockers).toEqual([]);
    unavailable = true;
    const failed = await app.inject('/api/scheduler');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private-cause');
    expect(failed.body).not.toContain('blockers');
  } finally {
    await app.close();
  }
});

it('returns prompt acceptance and observations, and separates observable busy attempts from legacy ownership', async () => {
  const id = '65361fc1-cee7-46c7-aefb-6bfbf75d1824';
  let outcome: import('../src/capabilities/plan/index.js').AttemptSubmission = {
    kind: 'accepted',
    id,
  };
  const app = operationsServer({
    base: 'a'.repeat(40),
    job: idle,
    run: Effect.runPromise,
    attempts: {
      submit: async () => outcome,
      observe: async (value) =>
        value === id ? { id, phase: 'discovery', elapsedMs: 0 } : undefined,
    },
  });
  try {
    const accepted = await app.inject({ method: 'POST', url: '/api/plan', payload: {} });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers.location).toBe(`/api/plan/${id}`);
    expect((await app.inject(`/api/plan/${id}`)).json()).toMatchObject({ id, phase: 'discovery' });
    outcome = { kind: 'busy', id };
    const busy = await app.inject({ method: 'POST', url: '/api/plan', payload: {} });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ attemptId: id });
    outcome = { kind: 'blocked', requestId: id, reason: 'reconciliation-required' };
    const blocked = await app.inject({ method: 'POST', url: '/api/plan', payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.headers.location).toBeUndefined();
    expect(blocked.json()).toMatchObject({ requestId: id, reason: 'reconciliation-required' });
    expect(blocked.json()).not.toHaveProperty('attemptId');
    expect((await app.inject('/api/plan/unknown')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
