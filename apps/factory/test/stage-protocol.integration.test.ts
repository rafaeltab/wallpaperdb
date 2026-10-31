import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution } from '../src/adapters/t3/index.js';
import type { Intent, StageRequest } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
type Fixture = {
  host: Awaited<ReturnType<typeof protocol>>;
  adapter: ReturnType<typeof t3Execution>;
  intent: Intent;
  request: StageRequest;
  review: StageRequest;
};
async function stageFixture(check: (fixture: Fixture) => Promise<void>) {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    const intent: Intent = {
      id: '1',
      issue: 577,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
      base: host.base,
      context: '',
      branch: 'factory/job-1',
      createdAt: 1,
      expectedStage: 'implementation',
    };
    const request: StageRequest = {
      index: 0,
      stage: 'implementation',
      threadId: 'thread-live',
      commit: host.base,
      previousRunId: null,
    };
    const review: StageRequest = { ...request, index: 1, stage: 'review', previousRunId: 'run-1' };
    await Effect.runPromise(adapter.launch(intent));
    await check({ host, adapter, intent, request, review });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
}
it('accepts only a structured outcome of the expected completed run at the clean current commit', () =>
  stageFixture(async ({ host, adapter, intent, request, review }) => {
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
    const receipt = {
      jobId: '1',
      stage: 'implementation',
      base: host.base,
      commit: host.base,
      outcome: '<TASK>COMPLETE</TASK>',
      tests: true,
      coverage: true,
      crap: true,
      reviews: false,
    };
    const valid = { role: 'assistant', runId: 'run-1', text: JSON.stringify(receipt) };
    const finished = { latestRunId: 'run-1', runCount: 1, status: 'completed' };
    await host.save({ overrides: finished, messages: [valid] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: host.base,
      runId: 'run-1',
      ordinal: 1,
    });
    for (const message of [
      { ...valid, role: 'user' },
      { ...valid, runId: 'old' },
      { ...valid, text: '> ' + valid.text },
      { ...valid, text: '<TASK>COMPLETE</TASK>' },
      { ...valid, text: JSON.stringify({ ...receipt, tests: false }) },
      { ...valid, text: JSON.stringify({ ...receipt, base: 'a'.repeat(40) }) },
    ]) {
      await host.save({ overrides: finished, messages: [message] });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
        accepted: true,
      });
    }
    await host.save({ overrides: { ...finished, runCount: 2 }, messages: [valid] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
    const reviewReceipt = {
      ...receipt,
      stage: 'review',
      outcome: '<REVIEW>COMPLETE</REVIEW>',
      reviews: false,
    };
    await host.save({
      overrides: { ...finished, latestRunId: 'run-2', runCount: 2 },
      messages: [{ ...valid, runId: 'run-2', text: JSON.stringify(reviewReceipt) }],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, review))).not.toMatchObject({
      accepted: true,
    });
    await host.save({
      overrides: { ...finished, latestRunId: 'run-2', runCount: 2 },
      messages: [
        { ...valid, runId: 'run-2', text: JSON.stringify({ ...reviewReceipt, reviews: true }) },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, review))).toMatchObject({
      accepted: true,
      runId: 'run-2',
    });
  }));
it('refuses stage delivery and acceptance while the worktree has unreviewed changes', () =>
  stageFixture(async ({ host, adapter, intent, request, review }) => {
    await host.save({ complete: true, base: host.base, overrides: { status: 'completed' } });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
    await writeFile(join(host.directory, 'worker', 'unreviewed.txt'), 'unreviewed change');
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
    await expect(Effect.runPromise(adapter.sendStage(intent, review))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toHaveLength(0);
  }));
it('reconciles the fresh stage outcome after a send response is lost', () =>
  stageFixture(async ({ host, adapter, intent, review }) => {
    await host.save({
      complete: true,
      base: host.base,
      lostSend: true,
      overrides: { status: 'completed' },
    });
    await expect(Effect.runPromise(adapter.sendStage(intent, review))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toHaveLength(1);
    expect(await Effect.runPromise(adapter.inspectStage(intent, review))).toMatchObject({
      accepted: true,
      runId: 'run-2',
    });
  }));

it.each([false, true])(
  'preserves continuation delivery identity with advertised idempotency=%s',
  (supported) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      await host.save({
        idempotency: supported,
        lostSend: true,
        overrides: { status: 'completed' },
      });
      const continuation = {
        ...request,
        stage: 'babysitting' as const,
        index: 4,
        ordinal: 4,
        continuation: true,
      };
      await expect(
        Effect.runPromise(adapter.sendStage(intent, continuation))
      ).rejects.toMatchObject({ _tag: 'Unavailable' });
      const sends = (await host.calls()).filter(
        (call) => call.args[1] === 'send' && !call.args.includes('--help')
      );
      expect(sends).toHaveLength(1);
      expect(sends[0].args[3]).toContain('continue. Use $babysit-pr');
      expect(sends[0].args[3]).toContain('delivery 1:4');
      expect(sends[0].args.includes('--client-request-id')).toBe(supported);
      if (supported) expect(sends[0].args).toContain('1:stage:4');
    })
);
it('recognizes only the current expected assistant waiting receipt, without accepting it as readiness', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const babysit = { ...request, stage: 'babysitting' as const, index: 4, ordinal: 4 };
    const overrides = { status: 'completed', runCount: 4, latestRunId: 'repair-4' };
    const message = {
      role: 'assistant',
      runId: 'repair-4',
      text: JSON.stringify({
        delivery: `${intent.id}:4`,
        jobId: intent.id,
        stage: 'babysitting',
        base: host.base,
        outcome: 'WAITING_FOR_GITHUB',
      }),
    };
    await host.save({ overrides, messages: [message] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, babysit))).toMatchObject({
      accepted: false,
      waitingForGitHub: true,
      commit: host.base,
    });
    for (const invalid of [
      { ...message, role: 'user' },
      { ...message, runId: 'old' },
      { ...message, text: '> ' + message.text },
      { ...message, text: '<PR>READY</PR>' },
    ]) {
      await host.save({ overrides, messages: [invalid] });
      expect(await Effect.runPromise(adapter.inspectStage(intent, babysit))).not.toMatchObject({
        waitingForGitHub: true,
      });
    }
  }));
it('accepts a latest watcher receipt only with the owning delivery identity and current commit', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const babysit = { ...request, stage: 'babysitting' as const, index: 4, ordinal: 4 };
    const overrides = { status: 'completed', runCount: 5, latestRunId: 'watcher-5' };
    const waiting = {
      delivery: `${intent.id}:4`,
      jobId: intent.id,
      stage: 'babysitting',
      base: host.base,
      outcome: 'WAITING_FOR_GITHUB',
    };
    const message = { role: 'assistant', runId: 'watcher-5', text: JSON.stringify(waiting) };
    await host.save({ overrides, messages: [message] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, babysit))).toMatchObject({
      accepted: false,
      waitingForGitHub: true,
      ordinal: 5,
      stageIndex: 4,
    });
    const success = {
      ...waiting,
      outcome: '<PR>READY</PR>',
      commit: host.base,
      tests: true,
      coverage: true,
      crap: true,
      reviews: true,
    };
    await host.save({ overrides, messages: [{ ...message, text: JSON.stringify(success) }] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, babysit))).toMatchObject({
      accepted: true,
      ordinal: 5,
      stageIndex: 4,
      runId: 'watcher-5',
    });
    for (const invalid of [
      { ...success, delivery: `${intent.id}:3` },
      { ...success, commit: 'f'.repeat(40) },
    ]) {
      await host.save({ overrides, messages: [{ ...message, text: JSON.stringify(invalid) }] });
      expect(await Effect.runPromise(adapter.inspectStage(intent, babysit))).not.toMatchObject({
        accepted: true,
      });
    }
  }));
