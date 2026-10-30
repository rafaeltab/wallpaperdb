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
