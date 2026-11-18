import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('observes only managed lineage, replaces historical activity by identity and retains facts across disconnect and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-t3-observations-'));
  initializeState(directory);
  const requested: string[] = [];
  let update!: (value: unknown) => void;
  let inventoryUpdate!: (value: unknown) => void;
  const thread = (id: string, parentThreadId: string | null) => ({
    id,
    projectId: 'project',
    title: id,
    lineage: { parentThreadId },
    status: 'completed',
    latestRunId: 'run',
    activeRunId: null,
    blockedOnThreadWait: false,
    pendingBackgroundTasks: [],
    pullRequests: [],
  });
  const host = await websocketProtocol((raw, send) => {
    const request = z
      .object({
        _tag: z.string(),
        id: z.string().optional(),
        tag: z.string().optional(),
        payload: z.object({ threadId: z.string().optional() }).optional(),
      })
      .parse(raw);
    if (request._tag !== 'Request') return;
    if (request.tag === 'orchestration.subscribeShell') {
      inventoryUpdate = (value) => send({ _tag: 'Chunk', requestId: request.id, values: [value] });
      send({
        _tag: 'Chunk',
        requestId: request.id,
        values: [
          {
            kind: 'snapshot',
            snapshot: {
              snapshotSequence: 10,
              threads: [thread('owner', null), thread('child', 'owner'), thread('unrelated', null)],
              archivedThreads: [],
              projects: [],
            },
          },
          { kind: 'synchronized' },
        ],
      });
    } else {
      const id = request.payload?.threadId;
      if (!id) throw new Error('Missing thread');
      requested.push(id);
      if (id === 'owner')
        update = (value) => send({ _tag: 'Chunk', requestId: request.id, values: [value] });
      send({
        _tag: 'Chunk',
        requestId: request.id,
        values: [
          {
            kind: 'snapshot',
            snapshotSequence: 10,
            projection: {
              thread: {
                ...thread(id, null),
                modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
                branch: 'factory/owner',
                worktreePath: '/managed/worktree',
              },
              runs: [{ id: 'run', ordinal: 1, status: 'completed' }],
              attempts: [],
              runtimeRequests: [],
              providerThreads: [],
              messages: [],
              turnItems:
                id === 'owner'
                  ? [
                      {
                        id: 'historical',
                        threadId: id,
                        runId: 'run',
                        nodeId: null,
                        type: 'command_execution',
                        ordinal: 0,
                        status: 'pending',
                      },
                    ]
                  : [],
              visibleTurnItems: [],
            },
          },
          { kind: 'synchronized' },
        ],
      });
    }
  });
  const observer = await t3Observations({
    origin: host.origin,
    checkpoints: sqliteObservationCheckpoints(directory),
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  });
  try {
    observer.retain('owner');
    await vi.waitFor(() => expect([...requested].sort()).toEqual(['child', 'owner']));
    await vi.waitFor(() =>
      expect(observer.activity('owner').items).toMatchObject([
        { itemId: 'historical', status: 'pending' },
      ])
    );
    expect(observer.inactive('owner', 'run')).toBe('busy');
    update({
      kind: 'event',
      sequence: 15,
      event: {
        type: 'turn-item.updated',
        threadId: 'owner',
        payload: {
          id: 'historical',
          threadId: 'owner',
          runId: 'run',
          nodeId: null,
          type: 'command_execution',
          ordinal: 0,
          status: 'completed',
        },
      },
    });
    await vi.waitFor(() =>
      expect(observer.activity('owner').items).toMatchObject([
        { itemId: 'historical', status: 'completed' },
      ])
    );
    expect(observer.inactive('owner', 'run')).toBe('busy');
    inventoryUpdate({ kind: 'thread.updated', sequence: 15, thread: thread('owner', null) });
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    expect(observer.activity('owner').items).toHaveLength(1);
    await host.close();
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('busy'));
    expect(observer.activity('owner').items).toMatchObject([
      { itemId: 'historical', status: 'completed' },
    ]);
    await observer.close();
    const reopened = await t3Observations({
      origin: host.origin,
      checkpoints: sqliteObservationCheckpoints(directory),
      credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
      report: () => undefined,
    });
    try {
      reopened.retain('owner');
      await vi.waitFor(() =>
        expect(reopened.activity('owner').items).toMatchObject([
          { itemId: 'historical', status: 'completed' },
        ])
      );
      expect(reopened.inactive('owner', 'run')).toBe('busy');
    } finally {
      await reopened.close();
    }
  } finally {
    await observer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
