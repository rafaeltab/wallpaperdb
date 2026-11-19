import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { t3Observations } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints, fileStore } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import { websocketProtocol } from './fixtures/websocket.js';
import { Unavailable } from '../src/capabilities/job/index.js';

it.each(['thread:owner', 'archive'])(
  'retries failed %s checkpoint initialization without restarting the observer',
  async (stream) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-checkpoint-retry-'));
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
    const positions: (number | undefined)[] = [];
    const host = await websocketProtocol((raw, send) => {
      const request = z
        .object({
          _tag: z.string(),
          id: z.string().optional(),
          tag: z.string().optional(),
          payload: z.object({ afterSequence: z.number().optional() }).optional(),
        })
        .parse(raw);
      if (request._tag !== 'Request') return;
      const reply = (values: unknown[]) => send({ _tag: 'Chunk', requestId: request.id, values });
      if (request.tag === 'orchestration.subscribeShell') {
        reply([
          {
            kind: 'snapshot',
            snapshot: { snapshotSequence: 10, threads: [row], archivedThreads: [], projects: [] },
          },
          { kind: 'synchronized' },
        ]);
      } else if (request.tag === 'orchestration.getArchivedShellSnapshot') {
        send({
          _tag: 'Exit',
          requestId: request.id,
          exit: { _tag: 'Success', value: { snapshotSequence: 10, threads: [] } },
        });
      } else {
        positions.push(request.payload?.afterSequence);
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
              turnItems: [],
            },
          },
          { kind: 'synchronized' },
        ]);
      }
    });
    const store = sqliteObservationCheckpoints(directory);
    const config = {
      origin: host.origin,
      checkpoints: store,
      credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
      report: () => undefined,
    };
    const first = await t3Observations(config);
    let recovering: Awaited<ReturnType<typeof t3Observations>> | undefined;
    let cancelled: Awaited<ReturnType<typeof t3Observations>> | undefined;
    let released = false;
    let attempts = 0;
    const checkpoints = {
      ...store,
      read: (key: string) =>
        Effect.suspend(() => {
          if (key.endsWith(`:${stream}`) && !released) {
            attempts++;
            return Effect.fail(
              new Unavailable({
                operation: 'controlled-checkpoint-read',
                cause: new Error('Controlled transient storage failure'),
              })
            );
          }
          return store.read(key);
        }),
    };
    try {
      first.retain('owner');
      await vi.waitFor(() => expect(first.inactive('owner', 'run')).toBe('idle'));
      await first.close();
      recovering = await t3Observations({ ...config, checkpoints });
      const observer = recovering;
      observer.retain('owner');
      await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2), { timeout: 3500 });
      expect(observer.inactive('owner', 'run')).toBe('busy');
      if (stream === 'archive') expect(observer.inventoryReady()).toBe(false);
      released = true;
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'), {
        timeout: 3500,
      });
      expect(positions.at(-1)).toBe(10);
      await observer.close();

      released = false;
      attempts = 0;
      cancelled = await t3Observations({ ...config, checkpoints });
      cancelled.retain('owner');
      await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(1));
      await cancelled.close();
      const stoppedAttempts = attempts;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(attempts).toBe(stoppedAttempts);
    } finally {
      await first.close();
      await recovering?.close();
      await cancelled?.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.each(['invalid bytes', 'missing entities'])(
  'recovers metadata with %s without erasing an execution claim or resuming from unusable state',
  async (fault) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-cache-recovery-'));
    initializeState(directory);
    let hold = false;
    let release: (() => void) | undefined;
    let resumedFrom: unknown = 'not requested';
    const host = await websocketProtocol((raw, send) => {
      const request = z
        .object({
          _tag: z.string(),
          id: z.string().optional(),
          tag: z.string().optional(),
          payload: z.object({ afterSequence: z.number().optional() }).optional(),
        })
        .parse(raw);
      if (request._tag !== 'Request') return;
      if (request.tag === 'orchestration.getArchivedShellSnapshot')
        send({
          _tag: 'Exit',
          requestId: request.id,
          exit: { _tag: 'Success', value: { snapshotSequence: 10, threads: [] } },
        });
      else if (request.tag === 'orchestration.subscribeShell') {
        const reply = () =>
          send({
            _tag: 'Chunk',
            requestId: request.id,
            values: [
              {
                kind: 'snapshot',
                snapshot: {
                  snapshotSequence: 10,
                  threads: [
                    {
                      id: 'unrelated',
                      projectId: 'project',
                      title: 'Unrelated',
                      lineage: { parentThreadId: null },
                      status: 'idle',
                      latestRunId: null,
                      activeRunId: null,
                      blockedOnThreadWait: false,
                      pendingBackgroundTasks: [],
                      pullRequests: [],
                    },
                  ],
                  archivedThreads: [],
                  projects: [],
                },
              },
              { kind: 'synchronized' },
            ],
          });
        if (hold) {
          resumedFrom = request.payload?.afterSequence;
          release = reply;
        } else reply();
      } else throw new Error('No conversation reads are needed for metadata recovery');
    });
    const store = sqliteObservationCheckpoints(directory);
    let inventory: string | undefined;
    const configuration = {
      origin: host.origin,
      checkpoints: {
        read: store.read,
        publish: (
          stream: string,
          revision: number,
          update: Parameters<typeof store.publish>[2]
        ) => {
          if (stream.endsWith(':inventory')) inventory = stream;
          return store.publish(stream, revision, update);
        },
      },
      credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
      report: () => undefined,
    };
    const claim = fileStore(directory);
    const intent = {
      id: 'existing-claim',
      issue: 819,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/819',
      base: 'a'.repeat(40),
      branch: 'factory/existing',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    await Effect.runPromise(claim.reserve(intent));
    expect(await Effect.runPromise(claim.claimLaunch())).toBe(true);
    const first = await t3Observations(configuration);
    let second: Awaited<ReturnType<typeof t3Observations>> | undefined;
    try {
      await vi.waitFor(() => expect(first.inventoryReady()).toBe(true));
      await first.close();
      if (!inventory) throw new Error('Missing inventory checkpoint');
      const before = await Effect.runPromise(store.read(inventory));
      if (!before) throw new Error('Missing applied inventory');
      await Effect.runPromise(
        store.publish(inventory, before.revision, {
          sequence: before.sequence,
          value: fault === 'invalid bytes' ? 'invalid cached bytes' : before.value,
          replaceEntities: true,
        })
      );
      hold = true;
      second = await t3Observations(configuration);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(resumedFrom).toBeUndefined();
      expect(second.inventoryReady()).toBe(false);
      release?.();
      const recovering = second;
      await vi.waitFor(() => expect(recovering.inventoryReady()).toBe(true));
      expect(await Effect.runPromise(claim.read())).toEqual(intent);
      expect(await Effect.runPromise(claim.claimLaunch())).toBe(false);
    } finally {
      await first.close();
      await second?.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
