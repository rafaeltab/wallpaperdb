import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Execution, t3Observations, t3Restacker } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { protocol } from './fixtures/setup.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('observes a retained owning execution during an outage without invoking a T3 process or releasing completion safeguards', async () => {
  const git = await protocol();
  const directory = await mkdtemp(join(tmpdir(), 'factory-retained-execution-'));
  initializeState(directory);
  const worktree = join(directory, 'worktree');
  execFileSync('git', [
    '-C',
    git.repository,
    'worktree',
    'add',
    '-b',
    'factory/retained',
    worktree,
    git.base,
  ]);
  const metadata = {
    id: 'owner',
    projectId: 'project',
    title: 'Factory retained',
    lineage: { parentThreadId: null },
    status: 'completed',
    latestRunId: 'run',
    activeRunId: null,
    blockedOnThreadWait: false,
    pendingBackgroundTasks: [],
    pullRequests: [],
  };
  const host = await websocketProtocol((raw, send) => {
    const request = z
      .object({ _tag: z.string(), id: z.string().optional(), tag: z.string().optional() })
      .parse(raw);
    if (request._tag !== 'Request') return;
    const reply = (values: unknown[]) => send({ _tag: 'Chunk', requestId: request.id, values });
    if (request.tag === 'orchestration.subscribeShell')
      reply([
        {
          kind: 'snapshot',
          snapshot: {
            snapshotSequence: 10,
            threads: [metadata],
            archivedThreads: [],
            projects: [],
          },
        },
        { kind: 'synchronized' },
      ]);
    else if (request.tag === 'orchestration.subscribeArchivedShell')
      reply([{ kind: 'snapshot', snapshot: { snapshotSequence: 10, threads: [], projects: [] } }]);
    else
      reply([
        {
          kind: 'snapshot',
          snapshotSequence: 10,
          projection: {
            thread: {
              ...metadata,
              modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
              branch: 'factory/retained',
              worktreePath: worktree,
            },
            runs: [{ id: 'run', ordinal: 1, status: 'completed' }],
            attempts: [],
            runtimeRequests: [],
            providerThreads: [],
            messages: [],
            turnItems: [],
            visibleTurnItems: [],
          },
        },
        { kind: 'synchronized' },
      ]);
  });
  const observations = await t3Observations({
    origin: host.origin,
    checkpoints: sqliteObservationCheckpoints(directory),
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  });
  const execution = t3Execution({
    observations,
    binary: '/must-not-run-t3',
    project: git.repository,
    projectId: 'project',
    mcpEndpoint: 'http://must-not-call.invalid/mcp',
    mcpAuthorizationFile: '/must-not-read-mcp-credential',
  });
  const intent = {
    id: 'retained',
    issue: 819,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/819',
    base: git.base,
    context: '',
    branch: 'factory/retained',
    createdAt: 0,
    expectedStage: 'implementation' as const,
  };
  try {
    await vi.waitFor(async () =>
      expect(await Effect.runPromise(execution.observe(intent))).toMatchObject({
        kind: 'found',
        threadId: 'owner',
        status: 'completed',
        worktree,
      })
    );
    await host.close();
    await vi.waitFor(() => expect(observations.inactive('owner', 'run')).toBe('busy'));
    expect(await Effect.runPromise(execution.observe(intent))).toMatchObject({
      kind: 'found',
      threadId: 'owner',
    });
    expect(
      await Effect.runPromise(
        execution.inspectStage(intent, {
          index: 0,
          stage: 'implementation',
          threadId: 'owner',
          previousRunId: null,
          commit: git.base,
        })
      )
    ).toBeNull();
  } finally {
    await observations.close();
    await host.close();
    await git.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps an uncertain recovery launch reserved while observation is unavailable, without querying T3 or launching another worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-retained-recovery-'));
  initializeState(directory);
  const host = await websocketProtocol(() => undefined);
  await host.close();
  const observations = await t3Observations({
    origin: host.origin,
    checkpoints: sqliteObservationCheckpoints(directory),
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  });
  const operation = {
    id: 'retained-recovery',
    issue: 819,
    pr: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
    oldHead: 'a'.repeat(40),
    parent: 'b'.repeat(40),
    onto: 'c'.repeat(40),
    context: 'Existing retained recovery',
  };
  const writes: string[] = [];
  const recovery = t3Restacker(
    { observations, binary: '/must-not-run-t3', project: directory, projectId: 'project' },
    operation,
    {
      read: async (name) => (name === 'launch.json' ? operation : null),
      write: async (name) => {
        writes.push(name);
        return false;
      },
    }
  );
  try {
    expect(await Effect.runPromise(recovery.resolve())).toMatchObject({
      bindingAvailable: false,
      progress: 'Recovery launch pending reconciliation',
    });
    expect(writes).toEqual([]);
  } finally {
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  }
});
