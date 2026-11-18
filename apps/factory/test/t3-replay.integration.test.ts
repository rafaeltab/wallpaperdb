import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('resumes applied facts, deduplicates replay and recovers unsupported or bounded responses through a complete snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-replay-'));
  initializeState(directory);
  const row = {
    id: 'owner',
    projectId: 'project',
    title: 'Owner',
    lineage: { parentThreadId: null },
    status: 'completed',
    latestRunId: 'run',
    activeRunId: null,
    blockedOnThreadWait: false,
    pendingBackgroundTasks: [],
    pullRequests: [],
  };
  const activity = (status: string) => ({
    id: 'historical',
    threadId: 'owner',
    runId: 'run',
    type: 'command_execution',
    ordinal: 0,
    status,
  });
  const snapshot = (sequence: number, status: string) => ({
    kind: 'snapshot',
    snapshotSequence: sequence,
    projection: {
      thread: {
        ...row,
        modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
        branch: null,
        worktreePath: null,
      },
      runs: [{ id: 'run', ordinal: 1, status: 'completed' }],
      attempts: [],
      runtimeRequests: [],
      providerThreads: [],
      messages: [],
      turnItems: [activity(status)],
    },
  });
  const event = (sequence: number, status: string) => ({
    kind: 'event',
    sequence,
    event: { type: 'turn-item.updated', threadId: 'owner', payload: activity(status) },
  });
  const positions: (number | undefined)[] = [];
  let metadataSequence = 10;
  let push!: (values: unknown[]) => void;
  let inventory!: (values: unknown[]) => void;
  let fallback = false;
  let bounded = false;
  let complete: (() => void) | undefined;
  const host = await websocketProtocol((raw, send) => {
    const request = z
      .object({
        _tag: z.string(),
        id: z.string().optional(),
        tag: z.string().optional(),
        payload: z
          .object({ threadId: z.string().optional(), afterSequence: z.number().optional() })
          .optional(),
      })
      .parse(raw);
    if (request._tag !== 'Request') return;
    const reply = (values: unknown[]) => send({ _tag: 'Chunk', requestId: request.id, values });
    if (request.tag === 'orchestration.getArchivedShellSnapshot')
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: { _tag: 'Success', value: { snapshotSequence: metadataSequence, threads: [] } },
      });
    else if (request.tag === 'orchestration.subscribeShell') {
      inventory = reply;
      reply([
        {
          kind: 'snapshot',
          snapshot: {
            snapshotSequence: metadataSequence,
            threads: [row],
            archivedThreads: [],
            projects: [],
          },
        },
        { kind: 'synchronized' },
      ]);
    } else if (request.tag === 'orchestration.subscribeThread') {
      positions.push(request.payload?.afterSequence);
      push = reply;
      if (fallback && !bounded) {
        bounded = true;
        reply([{ ...snapshot(25, 'completed'), hasMoreHistory: true }]);
      } else if (fallback)
        complete = () => reply([snapshot(25, 'completed'), { kind: 'synchronized' }]);
      else if (request.payload?.afterSequence === 10)
        reply([event(10, 'pending'), event(15, 'completed'), event(15, 'pending')]);
      else reply([snapshot(10, 'pending'), { kind: 'synchronized' }]);
    } else throw new Error('Unexpected protocol request');
  });
  const configuration = {
    origin: host.origin,
    checkpoints: sqliteObservationCheckpoints(directory),
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  };
  let observer = await t3Observations(configuration);
  try {
    observer.retain('owner');
    await vi.waitFor(() =>
      expect(observer.activity('owner').items).toMatchObject([{ status: 'pending' }])
    );
    await observer.close();
    metadataSequence = 15;
    observer = await t3Observations(configuration);
    observer.retain('owner');
    await vi.waitFor(() =>
      expect(observer.activity('owner').items).toMatchObject([{ status: 'completed' }])
    );
    expect(positions).toEqual([undefined, 10]);
    expect(observer.activity('owner').items).toHaveLength(1);
    expect(observer.inactive('owner', 'run')).toBe('busy');
    push([{ kind: 'synchronized' }]);
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    fallback = true;
    push([
      {
        kind: 'event',
        sequence: 20,
        event: { type: 'unsupported.future-event', threadId: 'owner', payload: {} },
      },
    ]);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'), { timeout: 5000 });
    expect(positions.slice(2)).toEqual([undefined, undefined]);
    expect(observer.inactive('owner', 'run')).toBe('busy');
    complete?.();
    inventory([{ kind: 'thread.updated', sequence: 25, thread: row }]);
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    expect(observer.activity('owner').items).toHaveLength(1);
  } finally {
    await observer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
