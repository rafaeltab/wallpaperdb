import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it.each(['completed', 'stale', 'new descendant', 'resumed', 'waiting'])(
  'confirms managed inactivity in the background when shell updates are suppressed: %s',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-family-freshness-'));
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
    const item = (status: string) => ({
      id: 'historical',
      threadId: 'owner',
      runId: 'run',
      type: 'command_execution',
      ordinal: 0,
      status,
    });
    let update: ((value: unknown) => void) | undefined;
    const confirmations: ((value: unknown) => void)[] = [];
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
      const reply = (values: unknown[]) => send({ _tag: 'Chunk', requestId: request.id, values });
      const result = (value: unknown) =>
        send({ _tag: 'Exit', requestId: request.id, exit: { _tag: 'Success', value } });
      if (request.tag === 'orchestration.subscribeShell') {
        reply([
          {
            kind: 'snapshot',
            snapshot: { snapshotSequence: 10, threads: [row], archivedThreads: [], projects: [] },
          },
          { kind: 'synchronized' },
        ]);
      } else if (request.tag === 'orchestration.getArchivedShellSnapshot') {
        result({ snapshotSequence: 10, threads: [] });
      } else if (request.tag === 'orchestration.getThreadFamily') {
        expect(request.payload?.threadId).toBe('owner');
        confirmations.push(result);
      } else {
        expect(request.tag).toBe('orchestration.subscribeThread');
        update = (value) => reply([value]);
        reply([
          {
            kind: 'snapshot',
            snapshotSequence: 10,
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
              turnItems: [item('pending')],
            },
          },
          { kind: 'synchronized' },
        ]);
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
      await vi.waitFor(() => expect(update).toBeTypeOf('function'));
      expect(observer.inactive('owner', 'run')).toBe('busy');
      expect(confirmations).toHaveLength(0);
      if (!update) throw new Error('Missing managed detail stream');
      update({
        kind: 'event',
        sequence: 15,
        event: { type: 'turn-item.updated', threadId: 'owner', payload: item('completed') },
      });
      // No local inactivity read is needed to start confirmation. No shell update is sent.
      await vi.waitFor(() => expect(confirmations).toHaveLength(1), { timeout: 3000 });
      expect(observer.activity('owner').items).toMatchObject([
        { itemId: 'historical', status: 'completed' },
      ]);
      for (let i = 0; i < 100; i++) expect(observer.inactive('owner', 'run')).toBe('busy');
      expect(confirmations).toHaveLength(1);
      const threads =
        scenario === 'new descendant'
          ? [
              row,
              {
                ...row,
                id: 'child',
                lineage: { parentThreadId: 'owner' },
                status: 'running',
                activeRunId: 'run',
              },
            ]
          : scenario === 'resumed'
            ? [{ ...row, latestRunId: 'new-run', activeRunId: 'new-run', status: 'running' }]
            : scenario === 'waiting'
              ? [{ ...row, blockedOnThreadWait: true }]
              : [row];
      confirmations[0]?.({ snapshotSequence: scenario === 'stale' ? 14 : 15, threads });
      if (scenario === 'completed') {
        await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
        expect(confirmations).toHaveLength(1);
      } else {
        await vi.waitFor(() => expect(confirmations).toHaveLength(2), { timeout: 4000 });
        expect(observer.inactive('owner', 'run')).toBe('busy');
        if (scenario === 'stale') {
          confirmations[1]?.({ snapshotSequence: 15, threads: [row] });
          await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
        }
      }
    } finally {
      // Outstanding point requests must be cancelled by the service lifetime.
      await observer.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  10000
);
