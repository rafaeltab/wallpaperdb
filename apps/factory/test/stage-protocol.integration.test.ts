import { execFileSync } from 'node:child_process';
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

it('delivers the durable per-job PR target instead of the configured default', () =>
  stageFixture(async ({ host, adapter, intent, review }) => {
    await host.save({ lost: false, idempotency: true });
    await Effect.runPromise(adapter.sendStage({ ...intent, prBase: 'factory/A' }, review));
    const sends = (await host.calls()).filter(
      (call) => call.args[1] === 'send' && !call.args.includes('--help')
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].args[3]).toContain(
      'against PR target factory/A, pinned comparison ' + host.base
    );
  }));

it('delivers owned replay repair against the actual comparison and accepts only its current clean receipt', () =>
  stageFixture(async ({ host, adapter, intent }) => {
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Missing owner');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
    git(
      host.repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'new replay parent'
    );
    const parent = git(host.repository, 'rev-parse', 'HEAD');
    git(
      host.repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'replayed issue'
    );
    const head = git(host.repository, 'rev-parse', 'HEAD');
    const request: StageRequest = {
      index: 3,
      stage: 'babysitting',
      threadId: 'thread-live',
      commit: head,
      previousRunId: 'published',
      ordinal: 4,
      comparison: { base: parent, prBase: 'D', previousHead: host.base },
    };
    await host.save({ overrides: { status: 'running' } });
    await expect(Effect.runPromise(adapter.sendStage(intent, request))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await host.save({ overrides: { status: 'completed' } });
    await Effect.runPromise(adapter.sendStage(intent, request));
    const sent = (await host.calls()).filter(
      (c) => c.args[1] === 'send' && !c.args.includes('--help')
    );
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain(head);
    expect(JSON.stringify(sent[0])).toContain(parent);
    expect(JSON.stringify(sent[0])).toContain('actual comparison');
    git(binding.worktree, 'reset', '--hard', head);
    const receipt = {
      delivery: '1:3',
      jobId: '1',
      stage: 'babysitting',
      base: parent,
      commit: head,
      outcome: '<PR>READY</PR>',
      tests: true,
      coverage: true,
      crap: true,
      reviews: true,
    };
    await host.save({
      overrides: { status: 'completed', latestRunId: 'fixed', runCount: 4 },
      messages: [{ role: 'assistant', runId: 'fixed', text: JSON.stringify(receipt) }],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: head,
    });
    await host.save({
      overrides: { status: 'completed', latestRunId: 'fixed', runCount: 4 },
      messages: [
        {
          role: 'assistant',
          runId: 'fixed',
          text: JSON.stringify({ ...receipt, base: host.base }),
        },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
  }));

it('retries a failed implementation with its existing thread, ordinal, scope and receipt association', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({ idempotency: true, overrides: { status: 'failed' } });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      runId: 'run-1',
      ordinal: 1,
      accepted: false,
    });
    const retry = { ...request, index: 1, ordinal: 2, previousRunId: 'run-1', resume: true };
    await Effect.runPromise(adapter.sendStage(intent, retry));
    const sends = (await host.calls()).filter(
      (call) => call.args[1] === 'send' && !call.args.includes('--help')
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].args).toContain('thread-live');
    expect(sends[0].args).toContain(`${intent.id}:stage:1`);
    expect(sends[0].args[3]).toContain('Use $implement');
    expect(sends[0].args[3]).toContain('expected run ordinal 2');
    expect(sends[0].args[3]).toContain(intent.issueUrl);
    await expect(Effect.runPromise(adapter.sendStage(intent, retry))).rejects.toMatchObject({
      _tag: 'Unavailable',
      operation: 'stage-binding-changed',
    });
    const receipt = {
      jobId: intent.id,
      stage: 'implementation',
      base: intent.base,
      commit: host.base,
      outcome: '<TASK>COMPLETE</TASK>',
      tests: true,
      coverage: true,
      crap: true,
      reviews: false,
    };
    await host.save({
      overrides: { status: 'completed' },
      messages: [{ role: 'assistant', runId: 'run-2', text: JSON.stringify(receipt) }],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, retry))).toMatchObject({
      runId: 'run-2',
      ordinal: 2,
      accepted: true,
    });
    await host.save({
      overrides: { status: 'completed' },
      messages: [{ role: 'assistant', runId: 'run-1', text: JSON.stringify(receipt) }],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, retry))).toMatchObject({
      accepted: false,
    });
  }));

it.each(['publication', 'babysitting'] as const)(
  'continues terminal %s with reconciliatory instructions and the exact new receipt identity',
  (stage) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const ordinal = stage === 'publication' ? 3 : 4;
      const index = stage === 'publication' ? 2 : 4;
      await host.save({
        idempotency: true,
        overrides: { status: 'failed', runCount: ordinal, latestRunId: `run-${ordinal}` },
      });
      const pending = { ...request, stage, index, ordinal, previousRunId: `run-${ordinal - 1}` };
      expect(await Effect.runPromise(adapter.inspectStage(intent, pending))).toMatchObject({
        accepted: false,
        runId: `run-${ordinal}`,
        ordinal,
      });
      const retry = {
        ...pending,
        index: index + 1,
        ordinal: ordinal + 1,
        previousRunId: `run-${ordinal}`,
        resume: true,
      };
      await host.save({
        idempotency: true,
        overrides: { status: 'failed', runCount: 99, latestRunId: `run-${ordinal}` },
      });
      await expect(Effect.runPromise(adapter.sendStage(intent, retry))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
      await host.save({
        idempotency: true,
        overrides: { status: 'failed', runCount: ordinal, latestRunId: `run-${ordinal}` },
      });
      await Effect.runPromise(adapter.sendStage(intent, retry));
      const sends = (await host.calls()).filter(
        (c) => c.args[1] === 'send' && !c.args.includes('--help')
      );
      expect(sends).toHaveLength(1);
      expect(sends[0].args).toContain(`${intent.id}:stage:${index + 1}`);
      expect(sends[0].args[3]).toContain(
        stage === 'publication'
          ? 'inspect and reuse the existing PR'
          : 'without starting another watcher'
      );
      const receipt = {
        ...(stage === 'babysitting' ? { delivery: `${intent.id}:${index + 1}` } : {}),
        jobId: intent.id,
        stage,
        base: intent.base,
        commit: host.base,
        outcome: stage === 'publication' ? '<PR>CREATED</PR>' : '<PR>READY</PR>',
        tests: true,
        coverage: true,
        crap: true,
        reviews: true,
      };
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          { role: 'assistant', runId: `run-${ordinal + 1}`, text: JSON.stringify(receipt) },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, retry))).toMatchObject({
        accepted: true,
        ordinal: ordinal + 1,
        runId: `run-${ordinal + 1}`,
      });
      const stale =
        stage === 'babysitting'
          ? { ...receipt, delivery: `${intent.id}:${index}` }
          : { ...receipt, stage: 'review' };
      await host.save({
        overrides: { status: 'completed' },
        messages: [{ role: 'assistant', runId: `run-${ordinal + 1}`, text: JSON.stringify(stale) }],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, retry))).not.toMatchObject({
        accepted: true,
      });
    })
);

it('refuses publication retry for a dirty or changed reviewed head while preserving the clean valid case', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({ idempotency: true, overrides: { status: 'failed' } });
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Expected worker');
    const retry = {
      ...request,
      stage: 'publication' as const,
      index: 1,
      ordinal: 2,
      previousRunId: 'run-1',
      resume: true,
    };
    const path = join(binding.worktree, 'unreviewed.txt');
    await writeFile(path, 'unfinished publication edits');
    await expect(Effect.runPromise(adapter.sendStage(intent, retry))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', binding.worktree, ...args], { encoding: 'utf8' });
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'Unreviewed commit'
    );
    await expect(Effect.runPromise(adapter.sendStage(intent, retry))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(
      (await host.calls()).filter((c) => c.args[1] === 'send' && !c.args.includes('--help'))
    ).toHaveLength(0);
    git('reset', '--hard', host.base);
    await Effect.runPromise(adapter.sendStage(intent, retry));
    expect(
      (await host.calls()).filter((c) => c.args[1] === 'send' && !c.args.includes('--help'))
    ).toHaveLength(1);
  }));

it('reports actual clean/head proof for conclusively terminal babysitting without inventing acceptance', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({ overrides: { status: 'failed', latestRunId: 'run-4', runCount: 4 } });
    const stage = {
      ...request,
      stage: 'babysitting' as const,
      index: 4,
      ordinal: 4,
      previousRunId: 'run-3',
    };
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Expected worker');
    expect(await Effect.runPromise(adapter.inspectStage(intent, stage))).toMatchObject({
      accepted: false,
      worktreeClean: true,
      commit: host.base,
    });
    await writeFile(join(binding.worktree, 'unfinished.txt'), 'unfinished');
    expect(await Effect.runPromise(adapter.inspectStage(intent, stage))).toMatchObject({
      accepted: false,
      worktreeClean: false,
      commit: host.base,
    });
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', binding.worktree, ...args], { encoding: 'utf8' });
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'Unreviewed work'
    );
    const head = git('rev-parse', 'HEAD').trim();
    expect(head).not.toBe(host.base);
    expect(await Effect.runPromise(adapter.inspectStage(intent, stage))).toMatchObject({
      accepted: false,
      worktreeClean: true,
      commit: head,
    });
  }));
