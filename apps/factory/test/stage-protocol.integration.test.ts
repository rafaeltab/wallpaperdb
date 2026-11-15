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
function instruction(intent: Intent, request: StageRequest) {
  return {
    role: 'user',
    text: `Factory instruction ${intent.id}:${request.deliveryIndex ?? request.index}.`,
  };
}
function state(intent: Intent, head: string) {
  return {
    version: 1,
    kind: 'state',
    jobId: intent.id,
    implemented: String(intent.issue),
    base: intent.base,
    checked: head,
    reviewed: head,
    published: head,
    checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
  };
}
function response(intent: Intent, head: string) {
  return { role: 'assistant', runId: 'run-1', text: JSON.stringify(state(intent, head)) };
}
async function stageFixture(check: (fixture: Fixture) => Promise<void>) {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
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

it.each(['implementation', 'review', 'publication', 'babysitting'] as const)(
  'accepts %s state after its instruction despite later turns',
  (stage) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const current = { ...request, stage, index: 11, ordinal: 12, previousRunId: 'predecessor' };
      const success = response(intent, host.base);
      await host.save({
        overrides: { status: 'completed', latestRunId: 'wake', runCount: 500 },
        messages: [
          instruction(intent, current),
          success,
          { role: 'assistant', text: 'Delayed command completed.' },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
        accepted: true,
        ordinal: 500,
        stageIndex: 11,
      });
      await host.save({
        overrides: { status: 'completed' },
        messages: [success, instruction(intent, current)],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
        accepted: true,
      });
    })
);
it.each([
  { version: 2 },
  { version: undefined },
  { jobId: 'other' },
  { implemented: '999' },
  { base: 'f'.repeat(40) },
  { checked: 'f'.repeat(40) },
  { reviewed: 'f'.repeat(40) },
  { published: 'f'.repeat(40) },
  { checks: { format: true, lint: true, tests: true, coverage: true } },
  ...['format', 'lint', 'tests', 'coverage', 'crap'].map((check) => ({
    checks: { format: true, lint: true, tests: true, coverage: true, crap: true, [check]: false },
  })),
])(
  'rejects a newer incompatible publication response rather than restoring older success: %j',
  (change) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const current = { ...request, stage: 'publication' as const };
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          instruction(intent, current),
          response(intent, host.base),
          { role: 'assistant', text: JSON.stringify({ ...state(intent, host.base), ...change }) },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
        accepted: true,
      });
    })
);
it('does not accept legacy success or a dependency response as completed implementation', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    for (const value of [
      {
        jobId: intent.id,
        stage: 'implementation',
        commit: host.base,
        outcome: '<TASK>COMPLETE</TASK>',
        tests: true,
        coverage: true,
        crap: true,
        reviews: true,
      },
      { version: 1, kind: 'dependencies', jobId: intent.id, requireUnimplementedIssues: ['758'] },
    ]) {
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          instruction(intent, request),
          { role: 'assistant', text: JSON.stringify(value) },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
        accepted: true,
      });
    }
  }));
it('requires clean matching Git state and allows fresh review after a publication commit while preserving unrelated commits', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const current = { ...request, stage: 'publication' as const };
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Missing owner');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', binding.worktree, ...args], { encoding: 'utf8' }).trim();
    const save = (head: string) =>
      host.save({
        overrides: { status: 'completed' },
        messages: [instruction(intent, current), response(intent, head)],
      });
    await save(host.base);
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
      accepted: true,
    });
    await writeFile(join(binding.worktree, 'publication.txt'), 'necessary publication correction');
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
      accepted: true,
    });
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'publication correction'
    );
    const published = git('rev-parse', 'HEAD');
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
      accepted: true,
    });
    await save(published);
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
      accepted: true,
      commit: published,
    });
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'unrelated tooling'
    );
    const extra = git('rev-parse', 'HEAD');
    git('branch', 'preserved-extra', extra);
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
      accepted: true,
    });
    git('reset', '--hard', published);
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
      accepted: true,
      commit: published,
    });
    expect(git('rev-parse', 'preserved-extra')).toBe(extra);
  }));
it('resolves omitted publication enrichment through the exact owning thread association', () =>
  publicationFixture(async ({ host, adapter, intent, request, complete }) => {
    const url = 'https://github.com/rafaeltab/wallpaperdb/pull/999';
    // Complete enrichment remains a valid control and needs no extra metadata read.
    await host.save({
      ...complete,
      overrides: {
        status: 'completed',
        latestRunId: 'run-1',
        runCount: 1,
        pullRequests: [{ url }],
      },
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      linked: [url],
    });
    expect(
      (await host.calls()).filter((c) => c.args[1] === 'list_thread_pull_requests')
    ).toHaveLength(0);
    await host.save({
      ...complete,
      omitTranscriptPullRequests: true,
      associationReply: { structuredContent: { pullRequests: [{ url, source: 'agent' }] } },
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      linked: [url],
    });
    const reads = (await host.calls()).filter((c) => c.args[1] === 'list_thread_pull_requests');
    expect(reads).toHaveLength(1);
    expect(JSON.parse(reads[0].args[2])).toEqual({ threadId: 'thread-live' });
    expect((await host.calls()).filter((c) => ['start', 'send'].includes(c.args[1]))).toHaveLength(
      1
    );
  }));

it.each([
  { name: 'empty', pulls: [], linked: [] },
  {
    name: 'unrelated',
    pulls: [{ url: 'https://github.com/other/repo/pull/1', source: 'manual' }],
    linked: ['https://github.com/other/repo/pull/1'],
  },
  {
    name: 'conflicting',
    pulls: [
      { url: 'https://github.com/rafaeltab/wallpaperdb/pull/998', source: 'agent' },
      { url: 'https://github.com/rafaeltab/wallpaperdb/pull/999', source: 'agent' },
    ],
    linked: [
      'https://github.com/rafaeltab/wallpaperdb/pull/998',
      'https://github.com/rafaeltab/wallpaperdb/pull/999',
    ],
  },
  {
    name: 'dismissed stack',
    pulls: [
      { url: 'https://github.com/rafaeltab/wallpaperdb/pull/999', source: 'stack-dismissed' },
    ],
    linked: [],
  },
])(
  'preserves $name authoritative association evidence without inventing ownership',
  ({ pulls, linked }) =>
    publicationFixture(async ({ host, adapter, intent, request, complete }) => {
      await host.save({
        ...complete,
        omitTranscriptPullRequests: true,
        associationReply: { structuredContent: { pullRequests: pulls } },
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
        accepted: true,
        linked,
      });
      expect(
        (await host.calls()).filter((c) => ['start', 'send'].includes(c.args[1]))
      ).toHaveLength(1);
    })
);

it.each([
  { isError: true },
  { structuredContent: {} },
  { structuredContent: { pullRequests: null } },
])('keeps unavailable or malformed association metadata unverified: %j', (associationReply) =>
  publicationFixture(async ({ host, adapter, intent, request, complete }) => {
    await host.save({ ...complete, omitTranscriptPullRequests: true, associationReply });
    await expect(Effect.runPromise(adapter.inspectStage(intent, request))).rejects.toMatchObject({
      _tag: 'Unavailable',
      operation: 'inspect-stage',
    });
    expect((await host.calls()).filter((c) => ['start', 'send'].includes(c.args[1]))).toHaveLength(
      1
    );
  })
);

function publicationFixture(check: (fixture: Fixture & { complete: object }) => Promise<void>) {
  return stageFixture(async (fixture) => {
    const { host, intent } = fixture;
    const request = { ...fixture.request, stage: 'publication' as const, index: 2 };
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
    });
    const complete = {
      overrides: { status: 'completed', latestRunId: 'run-1', runCount: 1 },
      messages: [instruction(intent, request), response(intent, host.base)],
    };
    await check({ ...fixture, adapter, request, complete });
  });
}

it('retains a state response after delayed assistant prose without accepting a later negative state', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const instruction = {
      role: 'user',
      text: `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}. Factory instruction ${intent.id}:0.`,
    };
    const state = {
      version: 1,
      kind: 'state',
      jobId: intent.id,
      base: intent.base,
      implemented: String(intent.issue),
      checked: host.base,
      checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
    };
    const success = { role: 'assistant', runId: 'run-1', text: JSON.stringify(state) };
    const prose = {
      role: 'assistant',
      runId: 'notification',
      text: 'The delayed command has finished.',
    };
    const overrides = { status: 'completed', latestRunId: 'notification', runCount: 2 };
    await host.save({ overrides, messages: [instruction, success, prose] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: host.base,
    });
    await host.save({
      overrides,
      messages: [
        instruction,
        success,
        {
          ...success,
          text: JSON.stringify({ ...state, checks: { ...state.checks, lint: false } }),
        },
        prose,
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
  }));

it.each([
  '{"version":1,"kind":"state","checks":{"lint":false},',
  '{"checks":{"lint":false},"jobId":"1",',
  '{"kind":"dependencies","version":1,"requireUnimplementedIssues":["758"],',
  '{"version":2,"kind":"state",',
  String.raw`{"\u0076ersion":1,"\u006bind":"state","checks":{"lint":false},`,
  String.raw`{"\u006bind":"st\u0061te","checks":{"lint":false},`,
  String.raw`{"\u006aobId":"1","checks":{"lint":false},`,
  String.raw`{"kind":"st\u0061te`,
  '{"note":"{ not structural }","version":1,',
  '{"checks":{"lint":false} "jobId":"1",',
  '{"checks":{"lint":false} "kind":"state",',
  '{"checks":"failed" "jobId":"1",',
  '{"checks":false "jobId":"1",',
  '{"checks":false "kind":"state",',
  String.raw`{"checks":{"lint":false} "\u0076ersion":1,`,
  '{"checks" "jobId":"1",',
  '{"checks" "kind":"state",',
  '```json\n{"version":1,"kind":"state","checks":{"lint":false},\n```',
  '{"kind":"sta',
  '{"kind":"dep',
  '{"kind":"',
  String.raw`{"kind":"\u0073ta\u`,
  '{"kind":"sta\n',
])('withholds older success behind a newer malformed response: %s', (text) =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const success = response(intent, host.base);
    const messages = [instruction(intent, request), success];
    const overrides = { status: 'completed' };
    await host.save({ overrides, messages });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
    const malformed = { role: 'assistant', text };
    await host.save({ overrides, messages: [...messages, malformed] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: false,
      idle: true,
    });
    await host.save({ overrides, messages: [...messages, malformed, success] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
    expect(
      (await host.calls()).filter((c) => ['send', 't3_thread_send'].includes(c.args[1]))
    ).toHaveLength(0);
  })
);
it.each([
  'The delayed command finished; its log included {"version":1.',
  '{"command":"completed",',
  '{"command":"completed","result":{"version":1},',
  '{"command":"completed","result":{"kind":"state"},',
  '{"command":"completed","result":[{"jobId":"1"}],',
  '{"kind":"notification","text":"done",',
  '{"command":"version",',
  '{"command":"jobId",',
  '{"command":"kind",',
  '{"command":"jobId" "result":"version",',
  '```json\n{"command":"completed","result":{"version":1}}\n```',
  '{"kind":"notification',
  '{"kind":"notif',
  '{"kind":"command',
  '{"kind":"stateful',
  String.raw`{"kind":"not\u0069f`,
  String.raw`{"kind":"notif\u00`,
  '{"kind":"notif\n',
  `${JSON.stringify({ command: 'completed', result: '{"version":1}' }).slice(0, -1)},`,
])('retains coherent state after unrelated nonresponse text: %s', (text) =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({
      overrides: { status: 'completed' },
      messages: [
        instruction(intent, request),
        response(intent, host.base),
        { role: 'assistant', text },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
  })
);

it('accepts a coherent escaped JSON state at the current clean head', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const success = response(intent, host.base);
    success.text = success.text
      .replace('"version"', String.raw`"\u0076ersion"`)
      .replace('"kind"', String.raw`"\u006bind"`)
      .replace('"jobId"', String.raw`"\u006aobId"`)
      .replace('"state"', String.raw`"st\u0061te"`);
    await host.save({
      overrides: { status: 'completed' },
      messages: [instruction(intent, request), success],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: host.base,
    });
  }));

it.each([
  { activeRunId: 'active' },
  { status: 'running' },
  { status: 'queued' },
  { pendingRequestCount: 1 },
  { blockedOnThreadWait: true },
  { pendingBackgroundTasks: [{ taskId: 'command', kind: 'command' }] },
  { pullRequests: [{ url: 'https://github.com/rafaeltab/wallpaperdb/pull/999', watching: true }] },
])('requires idle owning activity before accepting state: %j', (overrides) =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const messages = [
      { role: 'user', text: `Factory instruction ${intent.id}:0.` },
      {
        role: 'assistant',
        text: JSON.stringify({
          version: 1,
          kind: 'state',
          jobId: intent.id,
          implemented: String(intent.issue),
          base: host.base,
          checked: host.base,
          checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
        }),
      },
    ];
    await host.save({ overrides: { status: 'completed' }, messages });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
    await host.save({ overrides: { status: 'completed', ...overrides }, messages });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
    expect(
      (await host.calls()).filter((c) => ['send', 't3_thread_send'].includes(c.args[1]))
    ).toHaveLength(0);
  })
);

it('traverses a completed child to reject an active grandchild and rejects missing inactivity evidence', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const messages = [
      { role: 'user', text: `Factory instruction ${intent.id}:0.` },
      {
        role: 'assistant',
        text: JSON.stringify({
          version: 1,
          kind: 'state',
          jobId: intent.id,
          implemented: String(intent.issue),
          base: host.base,
          checked: host.base,
          checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
        }),
      },
    ];
    const descendants = [
      { threadId: 'child', parentThreadId: 'thread-live' },
      { threadId: 'grandchild', parentThreadId: 'child' },
    ];
    await host.save({ overrides: { status: 'completed' }, messages, descendants });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
    await host.save({
      overrides: { status: 'completed' },
      messages,
      descendants,
      descendantSnapshots: { grandchild: { status: 'running' } },
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
    await host.save({
      overrides: { status: 'completed' },
      messages,
      mcpReply: {
        structuredContent: {
          thread: { latestRunId: 'run-1' },
          items: [],
          hasMore: false,
          nextPosition: null,
        },
      },
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
  }));
it.each(['message', 'user_input_request'])(
  'keeps pending %s activity busy even without an active run',
  (type) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const messages = [instruction(intent, request), response(intent, host.base)];
      await host.save({ overrides: { status: 'completed' }, messages });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
        accepted: true,
      });
      await host.save({
        overrides: { status: 'completed' },
        messages,
        activity: [
          {
            itemId: 'pending',
            runId: 'earlier-run',
            type,
            status: 'pending',
            sourceThreadId: 'thread-live',
            visibility: 'local',
            text: 'Queued work or question',
          },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
      expect(
        (await host.calls()).filter((c) => ['send', 't3_thread_send'].includes(c.args[1]))
      ).toHaveLength(0);
    })
);
it('cannot accept a response when the actual instruction has fallen out of retained history', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({
      overrides: { status: 'completed' },
      omitInstructionHistory: true,
      messages: [response(intent, host.base)],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).not.toMatchObject({
      accepted: true,
    });
  }));
it('ignores unrelated structured command output after a coherent response', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({
      overrides: { status: 'completed' },
      messages: [
        instruction(intent, request),
        response(intent, host.base),
        { role: 'assistant', text: JSON.stringify({ command: 'completed' }) },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
  }));
it('leaves a running-to-idle snapshot transition unverified until its completed history is read', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({
      overrides: { status: 'running' },
      descendantSnapshots: { 'thread-live': { status: 'completed' } },
      messages: [],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
    await host.save({
      overrides: { status: 'completed' },
      messages: [instruction(intent, request), response(intent, host.base)],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
    });
  }));
it.each(['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'])(
  'delivers reconciliation from a verified %s owning predecessor',
  (status) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      await host.save({ overrides: { status } });
      await Effect.runPromise(
        adapter.sendStage(intent, {
          ...request,
          index: 1,
          previousRunId: 'run-1',
          ordinal: 2,
          resume: true,
          reconciliation: 'state',
        })
      );
      const sends = (await host.calls()).filter((call) => call.args[1] === 't3_thread_send');
      expect(sends).toHaveLength(1);
      expect(JSON.parse(sends[0].args[2]).threadId).toBe('thread-live');
    })
);

it.each(['prose', 'malformed', 'invalid-version-one', 'legacy', 'supported-negative'] as const)(
  'distinguishes response support after migration: %s',
  (kind) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const text =
        kind === 'prose'
          ? 'I could not complete the migration.'
          : kind === 'malformed'
            ? '{"version":1,"kind":"state",'
            : kind === 'invalid-version-one'
              ? JSON.stringify({ version: 1, kind: 'state', jobId: intent.id })
              : kind === 'legacy'
                ? JSON.stringify({ jobId: intent.id, outcome: '<TASK>COMPLETE</TASK>' })
                : JSON.stringify({
                    ...state(intent, host.base),
                    checks: { ...state(intent, host.base).checks, tests: false },
                  });
      const migration = { ...request, reconciliation: 'migration' as const };
      await host.save({
        overrides: { status: 'completed' },
        messages: [instruction(intent, migration), { role: 'assistant', text }],
      });
      const evidence = await Effect.runPromise(adapter.inspectStage(intent, migration));
      expect(evidence?.accepted).toBe(false);
      expect(evidence?.migrationRequired).toBe(
        kind === 'legacy' ? true : kind === 'supported-negative' ? false : undefined
      );
    })
);

it('delivers bounded abandonment instructions to the existing agent without claiming successful checks', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    await host.save({ overrides: { status: 'completed' } });
    await Effect.runPromise(
      adapter.sendStage(intent, {
        ...request,
        index: 1,
        previousRunId: 'run-1',
        ordinal: 2,
        resume: true,
        handback: ['758'],
      })
    );
    const sends = (await host.calls()).filter((call) => call.args[1] === 't3_thread_send');
    expect(sends).toHaveLength(1);
    const delivery = JSON.parse(sends[0].args[2]);
    expect(delivery.threadId).toBe('thread-live');
    expect(JSON.stringify(delivery)).toContain('Close only an open PR');
    expect(JSON.stringify(delivery)).toContain('Do not relabel or admit prerequisites');
    expect(JSON.stringify(delivery)).toContain('Planned');
  }));

it.each(['implementation', 'review', 'publication', 'babysitting'] as const)(
  'translates the exact job-bound dependency list at the %s boundary without accepting completion',
  (stage) =>
    stageFixture(async ({ host, adapter, intent, request }) => {
      const current = { ...request, stage };
      const dependencies = ['758', '759'];
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          instruction(intent, current),
          {
            role: 'assistant',
            text: JSON.stringify({
              version: 1,
              kind: 'dependencies',
              jobId: intent.id,
              requireUnimplementedIssues: dependencies,
            }),
          },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
        dependencies: ['758', '759'],
        accepted: false,
        idle: true,
        stageIndex: current.index,
      });
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          instruction(intent, current),
          {
            role: 'assistant',
            text: JSON.stringify({
              version: 1,
              kind: 'dependencies',
              jobId: 'unrelated-job',
              requireUnimplementedIssues: dependencies,
            }),
          },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
        dependencies: ['758', '759'],
      });
    })
);

it('accepts an authenticated newer-main comparison at a freshly checked and reviewed head', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Missing owner');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', binding.worktree, ...args], { encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '--bare', join(host.directory, 'origin.git')]);
    git('remote', 'add', 'origin', join(host.directory, 'origin.git'));
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    await writeFile(join(binding.worktree, 'main.txt'), 'new main');
    git('add', '.');
    git('commit', '-m', 'main advancement');
    const base = git('rev-parse', 'HEAD');
    git('push', 'origin', 'HEAD:refs/heads/main');
    await writeFile(join(binding.worktree, 'issue.txt'), 'issue only');
    git('add', '.');
    git('commit', '-m', 'issue');
    const head = git('rev-parse', 'HEAD');
    const current = { ...request, stage: 'publication' as const };
    await host.save({
      overrides: { status: 'completed' },
      messages: [
        instruction(intent, current),
        { role: 'assistant', text: JSON.stringify({ ...state(intent, head), base }) },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).toMatchObject({
      accepted: true,
      commit: head,
      base,
    });
    for (const change of [
      { base: intent.base },
      { reviewed: intent.base },
      { base: 'f'.repeat(40) },
    ]) {
      await host.save({
        overrides: { status: 'completed' },
        messages: [
          instruction(intent, current),
          { role: 'assistant', text: JSON.stringify({ ...state(intent, head), base, ...change }) },
        ],
      });
      expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
        accepted: true,
      });
    }
    await host.save({
      overrides: { status: 'completed' },
      messages: [
        instruction(intent, current),
        { role: 'assistant', text: JSON.stringify({ ...state(intent, head), base }) },
      ],
    });
    git('push', 'origin', `${intent.base}:refs/heads/main`, '--force');
    expect(await Effect.runPromise(adapter.inspectStage(intent, current))).not.toMatchObject({
      accepted: true,
    });
  }));

it('requires manual recovery when rebasing to main omits a prepared unmerged prerequisite', () =>
  stageFixture(async ({ host, adapter, intent, request }) => {
    const binding = await Effect.runPromise(adapter.observe(intent));
    if (binding.kind !== 'found') throw new Error('Missing owner');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', binding.worktree, ...args], { encoding: 'utf8' }).trim();
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    execFileSync('git', ['init', '--bare', join(host.directory, 'origin.git')]);
    git('remote', 'add', 'origin', join(host.directory, 'origin.git'));
    await writeFile(join(binding.worktree, 'prerequisite.txt'), 'required open code');
    git('add', '.');
    git('commit', '-m', 'prerequisite');
    const prepared = git('rev-parse', 'HEAD');
    await writeFile(join(binding.worktree, 'issue.txt'), 'issue code');
    git('add', '.');
    git('commit', '-m', 'issue');
    git('switch', '--detach', intent.base);
    await writeFile(join(binding.worktree, 'main.txt'), 'main advancement');
    git('add', '.');
    git('commit', '-m', 'main');
    const main = git('rev-parse', 'HEAD');
    git('push', 'origin', 'HEAD:refs/heads/main');
    git('switch', intent.branch);
    git('rebase', '--onto', main, prepared);
    const head = git('rev-parse', 'HEAD');
    const original = { ...intent, base: prepared, prBase: 'prerequisite' };
    await host.save({
      overrides: { status: 'completed' },
      messages: [
        instruction(original, request),
        { role: 'assistant', text: JSON.stringify({ ...state(original, head), base: main }) },
      ],
    });
    expect(await Effect.runPromise(adapter.inspectStage(original, request))).toMatchObject({
      accepted: false,
      unexpectedBase: true,
      commit: head,
    });
    expect(git('ls-tree', '--name-only', head)).toBe('issue.txt\nmain.txt');
  }));
