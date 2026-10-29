import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
import {
  Unavailable,
  type Job,
  type Start,
  type Status,
  type StartResult,
} from '../src/capabilities/job/index.js';
it('translates start/status and all declared command outcomes without exposing causes', async () => {
  let received: Start | null = null;
  let result: StartResult = { kind: 'empty' };
  let failure = false;
  let current: Status = { kind: 'empty' };
  const job: Job = {
    start: (command) => {
      received = command;
      return failure
        ? Effect.fail(new Unavailable({ operation: 'hidden', cause: new Error('secret') }))
        : Effect.succeed(result);
    },
    status: () => Effect.succeed(current),
  };
  const app = operationsServer({ base: 'a'.repeat(40), job, run: Effect.runPromise });
  try {
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
    expect((await app.inject('/')).body).toContain('Selected issue number');
    const start = () =>
      app.inject({
        method: 'POST',
        url: '/api/job',
        payload: { issue: 576, context: 'Read only' },
      });
    expect((await start()).statusCode).toBe(202);
    expect(received).toEqual({ issue: 576, context: 'Read only', base: 'a'.repeat(40) });
    for (const [kind, status] of [
      ['occupied', 409],
      ['rejected', 422],
    ] as const) {
      result = { kind };
      const response = await start();
      expect(response.statusCode).toBe(status);
      expect(response.headers['content-type']).toContain('application/problem+json');
    }
    expect(
      (await app.inject({ method: 'POST', url: '/api/job', payload: { issue: 0 } })).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/job', payload: { issue: 576, base: 'evil' } }))
        .statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/job',
          headers: { origin: 'https://evil.test' },
          payload: { issue: 576 },
        })
      ).statusCode
    ).toBe(403);
    const intent = {
      id: '1',
      issue: 576,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      base: 'a'.repeat(40),
      context: '',
      branch: 'factory/job-1',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    for (const execution of [
      { kind: 'absent' as const },
      { kind: 'ambiguous' as const },
      {
        kind: 'found' as const,
        threadId: 'thread-1',
        status: 'completed',
        worktree: '<script>unsafe</script>',
        branch: 'factory/job-1',
        model: 'gpt-6.1-sol',
      },
    ]) {
      current = { kind: 'job', intent, execution, elapsedMs: 42000 };
      const rendered = (await app.inject('/')).body;
      expect(rendered).toContain('Elapsed: 42 seconds');
      expect(rendered).not.toContain('<form>');
      expect(rendered).not.toContain('<script>unsafe</script>');
      if (execution.kind === 'found') {
        expect(rendered).toContain('t3-thread://v1/thread-1');
        expect(rendered).toContain('does not establish implementation acceptance');
      }
    }
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
    failure = true;
    const failed = await start();
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('secret');
  } finally {
    await app.close();
  }
});
