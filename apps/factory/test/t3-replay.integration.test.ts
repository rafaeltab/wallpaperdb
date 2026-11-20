import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it.each([
  'complete',
  'stale recovery',
  'bounded recovery',
  'mismatched recovery',
  'failed recovery',
])(
  'resumes applied facts and recovers persistently bounded history: %s',
  async (scenario) => {
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
        runs: [
          { id: 'run', ordinal: 1, status: 'completed', startedAt: '2026-11-19T13:00:00Z' },
        ],
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
    const boundedNegotiation: (boolean | undefined)[] = [];
    let metadataSequence = 10;
    let push!: (values: unknown[]) => void;
    let inventory!: (values: unknown[]) => void;
    let fallback = false;
    let bounded = false;
    let complete: (() => void) | undefined;
    const historyRequests: string[] = [];
    let responses = 0;
    const host = await websocketProtocol(
      (raw, send) => {
        const request = z
          .object({
            _tag: z.string(),
            id: z.string().optional(),
            tag: z.string().optional(),
            payload: z
              .object({
                threadId: z.string().optional(),
                afterSequence: z.number().optional(),
                acceptBoundedSnapshot: z.boolean().optional(),
              })
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
          boundedNegotiation.push(request.payload?.acceptBoundedSnapshot);
          push = reply;
          if (fallback && !bounded) {
            bounded = true;
            reply([
              {
                ...snapshot(25, 'completed'),
                projection: {
                  ...snapshot(25, 'completed').projection,
                  turnItems: [{ ...activity('completed'), id: 'recent', ordinal: 1 }],
                },
                hasMoreHistory: true,
              },
            ]);
          } else if (fallback) {
            if (request.payload?.afterSequence === 25) reply([{ kind: 'synchronized' }]);
            else
              reply([
                {
                  ...snapshot(25, 'completed'),
                  projection: {
                    ...snapshot(25, 'completed').projection,
                    turnItems: [{ ...activity('completed'), id: 'recent', ordinal: 1 }],
                  },
                  hasMoreHistory: true,
                },
              ]);
          } else if (request.payload?.afterSequence === 10)
            reply([event(10, 'pending'), event(15, 'completed'), event(15, 'pending')]);
          else reply([snapshot(10, 'pending'), { kind: 'synchronized' }]);
        } else throw new Error('Unexpected protocol request');
      },
      (request, response) => {
        historyRequests.push(request.url ?? '');
        expect(request.url).toBe('/api/orchestration/threads/owner');
        expect(request.headers.authorization).toBe('Bearer controlled-observer');
        expect(request.headers['x-t3-orchestration-protocol']).toBe('2');
        complete = () => {
          responses++;
          if (responses === 1 && scenario === 'failed recovery') {
            response.writeHead(503);
            response.end('temporarily unavailable');
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              ...snapshot(25, 'pending'),
              ...(responses === 1 && scenario === 'stale recovery' ? { snapshotSequence: 24 } : {}),
              ...(responses === 1 && scenario === 'bounded recovery'
                ? { hasMoreHistory: true }
                : {}),
              projection: {
                ...snapshot(25, 'pending').projection,
                ...(responses === 1 && scenario === 'mismatched recovery'
                  ? { thread: { ...snapshot(25, 'pending').projection.thread, id: 'unrelated' } }
                  : {}),
                turnItems: [
                  activity('pending'),
                  { ...activity('completed'), id: 'recent', ordinal: 1 },
                ],
              },
            })
          );
        };
      }
    );
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
      expect(observer.activity('owner')).toMatchObject({
        recentRuns: [{ runId: 'run', startedAt: '2026-11-19T13:00:00Z' }],
      });
      await observer.close();
      metadataSequence = 15;
      observer = await t3Observations(configuration);
      observer.retain('owner');
      await vi.waitFor(() =>
        expect(observer.activity('owner').items).toMatchObject([{ status: 'completed' }])
      );
      expect(positions).toEqual([undefined, 10]);
      expect(boundedNegotiation).toEqual([true, true]);
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
      expect(positions.slice(2)).toEqual([undefined]);
      expect(historyRequests).toEqual(['/api/orchestration/threads/owner']);
      expect(observer.inactive('owner', 'run')).toBe('busy');
      complete?.();
      const attempts = scenario === 'complete' ? 1 : 2;
      if (attempts === 2) {
        await vi.waitFor(() => expect(historyRequests).toHaveLength(2), { timeout: 4000 });
        expect(observer.inactive('owner', 'run')).toBe('busy');
        expect(observer.activity('owner').items).toMatchObject([
          { itemId: 'historical', status: 'completed' },
        ]);
        complete?.();
      }
      inventory([{ kind: 'thread.updated', sequence: 25, thread: row }]);
      await vi.waitFor(
        () =>
          expect(positions.slice(2)).toEqual([
            ...Array.from({ length: attempts }, () => undefined),
            25,
          ]),
        { timeout: 3000 }
      );
      expect(observer.activity('owner').items).toMatchObject([
        { itemId: 'historical', status: 'pending' },
        { itemId: 'recent', status: 'completed' },
      ]);
      expect(observer.inactive('owner', 'run')).toBe('busy');
      push([event(30, 'completed')]);
      inventory([{ kind: 'thread.updated', sequence: 30, thread: row }]);
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
      expect(observer.activity('owner').items).toHaveLength(2);
      expect(positions.slice(2)).toEqual([
        ...Array.from({ length: attempts }, () => undefined),
        25,
      ]);
      expect(historyRequests).toHaveLength(attempts);
    } finally {
      await observer.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
