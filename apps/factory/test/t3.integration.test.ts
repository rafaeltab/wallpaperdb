import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution } from '../src/adapters/t3/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('reconciles a lost launch using real isolated Git binding and rejects contradictory observations', async () => {
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
      id: 'job-1',
      issue: 576,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      base: host.base,
      context: 'Read only',
      branch: 'factory/job-1',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'absent' });
    expect(await Effect.runPromise(adapter.launch(intent))).toEqual({ kind: 'uncertain' });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      threadId: 'thread-live',
      model: 'gpt-6.1-sol',
      branch: 'factory/job-1',
      worktree: host.directory + '/worker',
    });
    await host.save({ duplicate: true });
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    for (const overrides of [
      { model: 'wrong' },
      { projectId: 'wrong' },
      { branch: 'wrong' },
      { worktreePath: host.repository },
    ]) {
      await host.save({ overrides });
      expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    }
    await host.save({ malformed: true });
    await expect(Effect.runPromise(adapter.observe(intent))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('reads current structured questions, excluding historical and inherited questions', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const { writeFile } = await import('node:fs/promises');
    const authorizationFile = host.directory + '/authorization';
    await writeFile(authorizationFile, 'Bearer controlled-protocol');
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      mcpEndpoint: 'http://127.0.0.1:1/mcp',
      mcpAuthorizationFile: authorizationFile,
    });
    const intent: Intent = {
      id: 'questions',
      issue: 579,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
      base: host.base,
      context: 'Only 579',
      branch: 'factory/questions',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    await Effect.runPromise(adapter.launch(intent));
    const question = {
      itemId: 'question-1',
      runId: 'run-1',
      type: 'user_input_request',
      status: 'waiting',
      text: 'Choose the approved option?',
      sourceThreadId: 'thread-live',
      visibility: 'local',
    };
    await host.save({
      activity: [question],
      overrides: { pendingRequestCount: 1, status: 'running' },
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      question: { id: 'question-1', text: 'Choose the approved option?' },
    });
    for (const change of [
      { runId: 'old-run' },
      { sourceThreadId: 'other-thread' },
      { visibility: 'inherited' },
      { status: 'completed' },
      { status: 'cancelled' },
      { type: 'approval_request' },
    ]) {
      await host.save({ activity: [{ ...question, ...change }] });
      const observed = await Effect.runPromise(adapter.observe(intent));
      expect(observed).not.toHaveProperty('question', expect.anything());
    }
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('accepts only the new completed run after resuming the implementation stage', async () => {
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
      id: 'resume',
      issue: 579,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
      base: host.base,
      context: 'Only 579',
      branch: 'factory/resume',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    await Effect.runPromise(adapter.launch(intent));
    await host.save({ complete: true, base: host.base, overrides: { status: 'completed' } });
    const request = {
      stage: 'implementation' as const,
      index: 1,
      ordinal: 2,
      threadId: 'thread-live',
      commit: host.base,
      previousRunId: 'run-1',
      resume: true,
    };
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
    await Effect.runPromise(adapter.sendStage(intent, request));
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      ordinal: 2,
      runId: 'run-2',
      commit: host.base,
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
async function questionProtocol(
  check: (fixture: {
    host: Awaited<ReturnType<typeof protocol>>;
    adapter: ReturnType<typeof t3Execution>;
    intent: Intent;
  }) => Promise<void>
) {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const { writeFile } = await import('node:fs/promises');
    const authorization = `${host.directory}/authorization`;
    await writeFile(authorization, 'Bearer controlled-protocol');
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      mcpEndpoint: 'http://127.0.0.1:1/mcp',
      mcpAuthorizationFile: authorization,
    });
    const intent: Intent = {
      id: 'protocol',
      issue: 579,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
      base: host.base,
      context: 'Only 579',
      branch: 'factory/protocol',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    await Effect.runPromise(adapter.launch(intent));
    await check({ host, adapter, intent });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
}
it('reads a question on a later native MCP activity page', () =>
  questionProtocol(async ({ host, adapter, intent }) => {
    await host.save({
      activityPages: [
        { thread: { latestRunId: 'run-1' }, items: [], hasMore: true, nextPosition: 0 },
        {
          thread: { latestRunId: 'run-1' },
          items: [
            {
              itemId: 'q-page-2',
              runId: 'run-1',
              sourceThreadId: 'thread-live',
              visibility: 'local',
              type: 'user_input_request',
              status: 'waiting',
              text: 'Later question',
            },
          ],
          hasMore: false,
          nextPosition: null,
        },
      ],
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      question: { id: 'q-page-2', text: 'Later question' },
    });
  }));
it('decodes native MCP text envelopes when structured content is absent', () =>
  questionProtocol(async ({ host, adapter, intent }) => {
    await host.save({
      mcpReply: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              thread: { latestRunId: 'run-1' },
              items: [],
              hasMore: false,
              nextPosition: null,
            }),
          },
        ],
      },
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      run: { id: 'run-1', ordinal: 1 },
    });
  }));
it.each([{ isError: true }, { content: [] }, { content: [{ type: 'text', text: '{invalid' }] }])(
  'fails safely on unusable native MCP response %j',
  (mcpReply) =>
    questionProtocol(async ({ host, adapter, intent }) => {
      await host.save({ mcpReply });
      await expect(Effect.runPromise(adapter.observe(intent))).rejects.toMatchObject({
        _tag: 'Unavailable',
        operation: 'observe',
      });
    })
);
it.each([null, 0])('rejects non-advancing native activity pagination %j', (nextPosition) =>
  questionProtocol(async ({ host, adapter, intent }) => {
    const page = { thread: { latestRunId: 'run-1' }, items: [], hasMore: true, nextPosition };
    await host.save({ activityPages: [page, page] });
    await expect(Effect.runPromise(adapter.observe(intent))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  })
);
it.each([
  ['completed', ['q']],
  ['cancelled', []],
  ['waiting', []],
] as const)('distinguishes %s questions from observed answers', (status, answeredQuestions) =>
  questionProtocol(async ({ host, adapter, intent }) => {
    await host.save({
      activity: [
        {
          itemId: 'q',
          runId: 'run-1',
          sourceThreadId: 'thread-live',
          visibility: 'local',
          type: 'user_input_request',
          status,
          text: 'Choose?',
        },
      ],
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({ answeredQuestions });
  })
);
it('targets cancellation to its owning thread with a stable job-specific native request key', () =>
  questionProtocol(async ({ host, adapter, intent }) => {
    await Effect.runPromise(adapter.interrupt(intent, 'thread-live'));
    await Effect.runPromise(adapter.interrupt(intent, 'thread-live'));
    const calls = (await host.calls()).filter(
      (call) => call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_interrupt'
    );
    expect(calls.map((call) => JSON.parse(call.args[2]))).toEqual([
      {
        threadId: 'thread-live',
        clientRequestId: 'protocol:cancel',
        reason: 'Explicit factory cancellation',
      },
      {
        threadId: 'thread-live',
        clientRequestId: 'protocol:cancel',
        reason: 'Explicit factory cancellation',
      },
    ]);
  }));
