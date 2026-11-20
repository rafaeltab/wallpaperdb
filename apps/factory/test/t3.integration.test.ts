import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution, t3ExecutionConfiguration } from '../src/adapters/t3/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('preserves inherited effort, mode and permissions on a configured model launch', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ lost: false });
    const adapter = t3Execution({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    expect(
      await Effect.runPromise(
        adapter.launch({
          id: 'inherited',
          issue: 744,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/744',
          base: host.base,
          context: '',
          branch: 'factory/inherited',
          createdAt: 100,
          expectedStage: 'implementation',
          execution: { model: 'gpt-6.2-sol', effort: null, mode: null, permissionLevel: null },
        })
      )
    ).toEqual({ kind: 'submitted', threadId: 'thread-live' });
    const launch = (await host.calls()).find((call) => call.args[1] === 't3_thread_launch');
    if (!launch) throw new Error('Missing structured launch');
    const request = JSON.parse(launch.args[2]);
    expect(request.modelSelection).toEqual({
      instanceId: 'codex',
      model: 'gpt-6.2-sol',
      options: [],
    });
    expect(request).not.toHaveProperty('runtimeMode');
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('resolves a supported requested model omitted from the default capability list', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({
      executionCatalog: {
        runtimeMode: 'full-access',
        providers: [{ providerInstanceId: 'codex', constraints: [], omittedModels: 1, models: [] }],
      },
      executionSearchCatalog: {
        runtimeMode: 'full-access',
        providers: [
          {
            providerInstanceId: 'codex',
            constraints: [],
            models: [{ id: 'gpt-6.2-sol', options: [{ id: 'reasoningEffort', values: ['high'] }] }],
          },
        ],
      },
    });
    const adapter = t3ExecutionConfiguration({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    expect(await Effect.runPromise(adapter.catalog('gpt-6.2-sol'))).toMatchObject({
      models: [{ id: 'gpt-6.2-sol', efforts: ['high'] }],
    });
    expect(await Effect.runPromise(adapter.catalog('not-a-model'))).toMatchObject({ models: [] });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it.each(['standard', 'fast'] as const)(
  'launches configured %s execution controls through structured T3 requests',
  async (mode) => {
    const host = await protocol();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    try {
      await host.save({ lost: false });
      const adapter = t3Execution({
        ...host.mcp,
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
      });
      const intent: Intent = {
        id: 'configured',
        issue: 744,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/744',
        base: host.base,
        context: '',
        branch: 'factory/configured',
        createdAt: 100,
        expectedStage: 'implementation',
        execution: { model: 'gpt-6.2-sol', effort: 'high', mode, permissionLevel: 'auto' },
      };
      expect(await Effect.runPromise(adapter.launch(intent))).toEqual({
        kind: 'submitted',
        threadId: 'thread-live',
      });
      const request = (await host.calls()).find((call) => call.args[1] === 't3_thread_launch');
      expect(request).toBeDefined();
      expect(JSON.parse(request!.args[2])).toMatchObject({
        modelSelection: {
          instanceId: 'codex',
          model: 'gpt-6.2-sol',
          options: [
            { id: 'reasoningEffort', value: 'high' },
            { id: 'serviceTier', value: mode === 'fast' ? 'priority' : 'default' },
          ],
        },
        runtimeMode: 'auto',
        workspaceStrategy: {
          type: 'worktree',
          baseRef: host.base,
          branch: 'factory/configured',
          startFromOrigin: false,
        },
      });
      expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
        kind: 'found',
        model: 'gpt-6.2-sol',
        observedExecution: {
          model: 'gpt-6.2-sol',
          effort: 'high',
          serviceTier: mode === 'fast' ? 'priority' : 'default',
          permissionLevel: 'auto',
        },
      });
      await host.save({
        lost: false,
        complete: true,
        base: host.base,
        overrides: { status: 'completed' },
      });
      await Effect.runPromise(
        adapter.sendStage(intent, {
          stage: 'babysitting',
          index: 1,
          ordinal: 2,
          threadId: 'thread-live',
          commit: host.base,
          previousRunId: 'run-1',
        })
      );
      const delivery = (await host.calls()).find((call) => call.args[1] === 't3_thread_send');
      if (!delivery) throw new Error('Missing babysitting delivery');
      expect(JSON.parse(delivery.args[2]).message).toContain('Codex model gpt-6.2-sol');
    } finally {
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
      await host.cleanup();
    }
  }
);
it('derives effort, speed and permission choices from the configured installation and its permission ceiling', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({
      executionCatalog: {
        runtimeMode: 'auto',
        providers: [
          {
            providerInstanceId: 'codex',
            constraints: [],
            runtimeModes: ['approval-required', 'auto', 'full-access'],
            models: [
              {
                id: 'custom-model',
                options: [
                  { id: 'reasoningEffort', values: ['medium'] },
                  { id: 'serviceTier', values: ['default'] },
                ],
              },
            ],
          },
        ],
      },
    });
    const adapter = t3ExecutionConfiguration({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    expect(await Effect.runPromise(adapter.catalog())).toEqual({
      models: [{ id: 'custom-model', efforts: ['medium'], modes: ['standard'] }],
      permissionLevels: ['approval-required', 'auto'],
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('returns the confirmed owning thread from a successful launch', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ lost: false });
    const adapter = t3Execution({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    expect(
      await Effect.runPromise(
        adapter.launch({
          id: 'known-launch',
          issue: 576,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
          base: host.base,
          context: 'Only this issue',
          branch: 'factory/known-launch',
          createdAt: 100,
          expectedStage: 'implementation',
        })
      )
    ).toEqual({ kind: 'submitted', threadId: 'thread-live' });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('reconciles a lost launch using real isolated Git binding and rejects contradictory observations', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = t3Execution({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    const intent: Intent = {
      id: 'job-1',
      issueTitle: 'Implement a factory worker',
      issue: 576,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      base: host.base,
      context: 'Read only',
      prerequisiteEvidence: `Verified prerequisite issue 573, PR 591, reviewed and CI-passing commit ${host.base}`,
      branch: 'factory/job-1',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'absent' });
    expect(await Effect.runPromise(adapter.launch(intent))).toEqual({ kind: 'uncertain' });
    const starts = (await host.calls()).filter(
      (call) => call.args[1] === 'start' && call.args.includes('--worktree')
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].args[starts[0].args.indexOf('--title') + 1]).toBe(
      'Factory #576: Implement a factory worker [factory:job-1]'
    );
    expect(starts[0].args[3]).toContain(
      `Read only\nVerified prerequisite evidence: ${intent.prerequisiteEvidence}\n`
    );
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      threadId: 'thread-live',
      model: 'gpt-6.1-sol',
      branch: 'factory/job-1',
      worktree: `${host.directory}/worker`,
    });
    await host.save({ overrides: { title: 'Renamed worker [factory:job-1]' } });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({ kind: 'found' });
    await host.save({ overrides: { title: 'Factory job-1' } });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({ kind: 'found' });
    await host.save({ overrides: { title: 'Factory #576 [factory:another-job]' } });
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    await host.save({ duplicate: true });
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    expect(
      await Effect.runPromise(
        adapter.observe(intent, {
          index: 0,
          stage: 'implementation',
          threadId: 'thread-live',
          commit: intent.base,
          previousRunId: null,
        })
      )
    ).toMatchObject({ kind: 'found', threadId: 'thread-live' });
    for (const overrides of [
      { model: 'wrong' },
      { projectId: 'wrong' },
      { branch: 'wrong' },
      { worktreePath: host.repository },
    ]) {
      await host.save({ overrides });
      expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    }
    await host.save({ overrides: { branch: 'wrong', status: 'completed' } });
    expect(
      await Effect.runPromise(
        adapter.observe(intent, {
          index: 0,
          stage: 'implementation',
          threadId: 'thread-live',
          commit: intent.base,
          previousRunId: null,
        })
      )
    ).toMatchObject({ kind: 'unverified', threadId: 'thread-live', status: 'completed' });
    await host.save({
      overrides: { worktreePath: `${host.directory}/missing-checkout`, status: 'completed' },
    });
    expect(
      await Effect.runPromise(
        adapter.observe(intent, {
          index: 0,
          stage: 'implementation',
          threadId: 'thread-live',
          commit: intent.base,
          previousRunId: null,
        })
      )
    ).toEqual({
      kind: 'unverified',
      threadId: 'thread-live',
      status: 'completed',
      run: { id: 'run-1', ordinal: 1 },
    });
    for (const overrides of [{ threadId: 'another-worker' }, { projectId: 'wrong' }]) {
      await host.save({ overrides });
      expect(
        await Effect.runPromise(
          adapter.observe(intent, {
            index: 0,
            stage: 'implementation',
            threadId: 'thread-live',
            commit: intent.base,
            previousRunId: null,
          })
        )
      ).toEqual({ kind: 'ambiguous' });
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
    const authorizationFile = `${host.directory}/authorization`;
    await writeFile(authorizationFile, 'Bearer controlled-protocol');
    const adapter = t3Execution({
      ...host.mcp,
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
      updatedAt: '2026-11-20T12:00:00.000Z',
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
      question: {
        id: 'question-1',
        text: 'Choose the approved option?',
        startedAt: Date.parse('2026-11-20T12:00:00.000Z'),
      },
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
      if (change.status === 'completed' || change.status === 'cancelled')
        expect(observed).toMatchObject({ closedQuestions: ['question-1'] });
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
      ...host.mcp,
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
      ...host.mcp,
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
it('distinguishes manual instructions from notifications and later factory-owned delivery using native provenance', () =>
  questionProtocol(async ({ host, adapter, intent }) => {
    const manual = {
      itemId: 'manual',
      position: 10,
      runId: 'run-1',
      createdBy: 'user',
      creationSource: 'web',
      sourceThreadId: 'thread-live',
      visibility: 'local',
      type: 'user_message',
      status: 'completed',
      text: 'Please continue',
    };
    const notification = {
      ...manual,
      itemId: 'notice',
      position: 11,
      createdBy: 'system',
      creationSource: 'mcp',
    };
    await host.save({ activity: [notification, manual] });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      manual: { runId: 'run-1' },
    });
    await host.save({
      activity: [
        manual,
        {
          ...notification,
          itemId: 'factory',
          position: 12,
          createdBy: 'agent',
          text: `Factory instruction ${intent.id}:8.`,
        },
      ],
    });
    expect(await Effect.runPromise(adapter.observe(intent))).not.toHaveProperty('manual.runId');
    await host.save({ activity: [{ ...manual, sourceThreadId: 'unrelated' }] });
    expect(await Effect.runPromise(adapter.observe(intent))).not.toHaveProperty('manual.runId');
  }));

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

it('translates only the current owning run start and leaves missing timing unknown', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = t3Execution({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    const intent: Intent = {
      id: 'timing',
      issue: 721,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/721',
      base: host.base,
      context: '',
      branch: 'factory/timing',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    await host.save({ lost: false });
    await Effect.runPromise(adapter.launch(intent));
    await host.save({
      overrides: { status: 'running', latestRunId: 'current-run', runCount: 2 },
      recentRuns: [
        { runId: 'old-run', startedAt: '2026-11-19T12:00:00Z' },
        { runId: 'current-run', startedAt: '2026-11-19T13:00:00Z' },
      ],
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      run: { id: 'current-run', ordinal: 2, startedAt: Date.parse('2026-11-19T13:00:00Z') },
    });
    await host.save({
      overrides: { status: 'running', latestRunId: 'current-run', runCount: 2 },
      recentRuns: [{ runId: 'old-run', startedAt: '2026-11-19T12:00:00Z' }],
    });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      run: { id: 'current-run', startedAt: undefined },
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
