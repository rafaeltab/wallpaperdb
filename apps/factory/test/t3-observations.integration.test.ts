import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { z } from 'zod';
import { t3Observations, ObservationUnknown } from '../src/adapters/t3/index.js';
import { sqliteObservationCheckpoints } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
import type { ObservationCheckpointUpdate } from '../src/capabilities/observe/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('preserves busy archived descendants discovered while shell metadata awaits family recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-archive-concurrency-'));
  initializeState(directory);
  const row = (id: string, status = 'completed') => ({
    id,
    projectId: 'project',
    title: id,
    lineage: { parentThreadId: id === 'child' ? 'owner' : null },
    archivedAt: id === 'child' ? '2026-11-01T00:00:00Z' : null,
    status,
    latestRunId: 'run',
    activeRunId: status === 'running' ? 'run' : null,
    blockedOnThreadWait: false,
    pendingBackgroundTasks: [],
    pullRequests: [],
  });
  let shellUpdate: ((values: unknown[]) => void) | undefined;
  let archiveReply: (() => void) | undefined;
  let familyReply: (() => void) | undefined;
  let childUpdate: ((values: unknown[]) => void) | undefined;
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
      shellUpdate = reply;
      reply([
        {
          kind: 'snapshot',
          snapshot: { snapshotSequence: 10, threads: [row('owner')], archivedThreads: [] },
        },
        { kind: 'synchronized' },
      ]);
    } else if (request.tag === 'orchestration.getArchivedShellSnapshot') {
      archiveReply = () => result({ snapshotSequence: 30, threads: [row('child', 'running')] });
    } else if (request.tag === 'orchestration.getThreadFamily') {
      familyReply = () => result({ snapshotSequence: 21, threads: [] });
    } else if (request.tag === 'orchestration.subscribeThread') {
      const id = request.payload?.threadId;
      if (!id) throw new Error('Missing managed thread');
      if (id === 'child') childUpdate = reply;
      reply([
        {
          kind: 'snapshot',
          snapshotSequence: 10,
          projection: {
            thread: {
              ...row(id),
              modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
              branch: null,
              worktreePath: null,
            },
            runs: [{ id: 'run', ordinal: 1, status: id === 'child' ? 'running' : 'completed' }],
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
  const checkpoints = sqliteObservationCheckpoints(directory);
  const observer = await t3Observations({
    origin: host.origin,
    checkpoints,
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  });
  try {
    observer.retainJob(819, 'archive-job', 'owner');
    await vi.waitFor(() => {
      expect(shellUpdate).toBeDefined();
      expect(archiveReply).toBeDefined();
      expect(observer.list('project')).toContainEqual({ threadId: 'owner', title: 'owner' });
    });
    shellUpdate?.([
      { kind: 'thread.updated', sequence: 20, thread: { ...row('owner'), title: 'updated owner' } },
      { kind: 'thread.removed', sequence: 21, threadId: 'removed' },
    ]);
    await vi.waitFor(() => expect(familyReply).toBeDefined());
    archiveReply?.();
    await vi.waitFor(async () =>
      expect(
        (await Effect.runPromise(checkpoints.read(`t3:${host.origin}:archive`)))?.sequence
      ).toBe(30)
    );
    familyReply?.();
    await vi.waitFor(() => {
      expect(observer.inventoryReady()).toBe(true);
      expect(observer.list('project')).toContainEqual({
        threadId: 'owner',
        title: 'updated owner',
      });
    });
    expect(observer.inactive('owner', 'run')).toBe('busy');
    expect(observer.list('project')).toContainEqual({ threadId: 'child', title: 'child' });
    expect(observer.retireIssue(819)).toBe(false);
    await vi.waitFor(() => expect(childUpdate).toBeDefined());
    childUpdate?.([
      {
        kind: 'event',
        sequence: 40,
        event: {
          threadId: 'child',
          type: 'run.updated',
          payload: { id: 'run', ordinal: 1, status: 'completed' },
        },
      },
    ]);
    shellUpdate?.([{ kind: 'thread.updated', sequence: 40, thread: row('child') }]);
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    expect(observer.retireIssue(819)).toBe(true);
  } finally {
    await observer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(['owner', 'child'])(
  'keeps inactivity unverified when %s watcher metadata is omitted',
  async (missing) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-watcher-evidence-'));
    initializeState(directory);
    const row = (id: string, enriched = true) => ({
      id,
      projectId: 'project',
      title: id,
      lineage: { parentThreadId: id === 'child' ? 'owner' : null },
      status: 'completed',
      latestRunId: 'run',
      activeRunId: null,
      blockedOnThreadWait: false,
      pendingBackgroundTasks: [],
      ...(enriched ? { pullRequests: [] } : {}),
    });
    let update: ((value: unknown) => void) | undefined;
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
      if (request.tag === 'orchestration.subscribeShell') {
        update = (value) => reply([value]);
        reply([
          {
            kind: 'snapshot',
            snapshot: {
              snapshotSequence: 10,
              threads: [row('owner'), row('child')],
              archivedThreads: [],
              projects: [],
            },
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
        const id = request.payload?.threadId;
        if (!id) throw new Error('Missing managed thread');
        reply([
          {
            kind: 'snapshot',
            snapshotSequence: 10,
            projection: {
              thread: {
                ...row(id),
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
    const observer = await t3Observations({
      origin: host.origin,
      checkpoints: sqliteObservationCheckpoints(directory),
      credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
      report: () => undefined,
    });
    try {
      observer.retainJob(819, 'watcher-job', 'owner');
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
      if (!update) throw new Error('Missing shell stream');
      update({ kind: 'thread.updated', sequence: 15, thread: row(missing, false) });
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('busy'));
      expect(observer.retireIssue(819)).toBe(false);
      update({
        kind: 'thread.updated',
        sequence: 20,
        thread: { ...row(missing), pullRequests: [{ watching: true }] },
      });
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('waiting'));
      expect(observer.retireIssue(819)).toBe(false);
      update({ kind: 'thread.updated', sequence: 25, thread: row(missing) });
      await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
      expect(observer.retireIssue(819)).toBe(true);
    } finally {
      await observer.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

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
    } else if (request.tag === 'orchestration.getArchivedShellSnapshot') {
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: { _tag: 'Success', value: { snapshotSequence: 10, threads: [], projects: [] } },
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
  const persisted: { stream: string; update: ObservationCheckpointUpdate }[] = [];
  const checkpoints = sqliteObservationCheckpoints(directory);
  const observer = await t3Observations({
    origin: host.origin,
    checkpoints: {
      read: checkpoints.read,
      publish: (stream, revision, update) => {
        persisted.push({ stream, update });
        return checkpoints.publish(stream, revision, update);
      },
    },
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
    expect(
      persisted.find(
        (entry) => entry.stream.endsWith('thread:owner') && entry.update.sequence === 15
      )?.update.entities
    ).toHaveLength(1);
    inventoryUpdate({ kind: 'thread.updated', sequence: 15, thread: thread('owner', null) });
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    expect(observer.activity('owner').items).toHaveLength(1);
    inventoryUpdate({
      kind: 'thread.updated',
      sequence: 20,
      thread: {
        ...thread('owner', null),
        latestRunId: 'resumed',
        activeRunId: 'resumed',
        status: 'running',
      },
    });
    await vi.waitFor(() => expect(() => observer.show('owner', 1)).toThrow(ObservationUnknown));
    inventoryUpdate({
      kind: 'snapshot',
      snapshot: { snapshotSequence: 25, threads: [], archivedThreads: [], projects: [] },
    });
    await vi.waitFor(() => expect(observer.list('project')).toEqual([]));
    expect(observer.inactive('owner', 'run')).toBe('busy');
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

it('bootstraps archived descendants and discovers descendants created below a finished parent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-t3-archive-'));
  initializeState(directory);
  const requested = new Set<string>();
  let metadataUpdate!: (value: unknown) => void;
  const row = (id: string, parentThreadId: string | null, archivedAt: string | null = null) => ({
    id,
    projectId: 'project',
    title: id,
    lineage: { parentThreadId },
    archivedAt,
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
    const reply = (values: unknown[]) => send({ _tag: 'Chunk', requestId: request.id, values });
    if (request.tag === 'orchestration.subscribeShell') {
      metadataUpdate = (value) => reply([value]);
      reply([
        {
          kind: 'snapshot',
          snapshot: {
            snapshotSequence: 10,
            projects: [],
            threads: [row('owner', null)],
            archivedThreads: [],
          },
        },
        { kind: 'synchronized' },
      ]);
    } else if (request.tag === 'orchestration.getArchivedShellSnapshot') {
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: {
          _tag: 'Success',
          value: {
            snapshotSequence: 10,
            projects: [],
            threads: [row('archived-child', 'owner', '2026-11-01T00:00:00Z')],
          },
        },
      });
    } else if (request.tag === 'orchestration.getThreadFamily') {
      expect(request.payload?.threadId).toBe('new-grandchild');
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: {
          _tag: 'Success',
          value: {
            snapshotSequence: 15,
            threads: [
              row('archived-child', 'owner', '2026-11-01T00:00:00Z'),
              row('new-grandchild', 'archived-child', '2026-11-01T00:00:00Z'),
            ],
          },
        },
      });
    } else {
      const id = request.payload?.threadId;
      if (!id) throw new Error('Missing managed thread');
      requested.add(id);
      reply([
        {
          kind: 'snapshot',
          snapshotSequence: 10,
          projection: {
            thread: {
              ...row(id, null),
              modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
              branch: 'factory/owner',
              worktreePath: '/managed/worktree',
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
    }
  });
  const observer = await t3Observations({
    origin: host.origin,
    checkpoints: sqliteObservationCheckpoints(directory),
    credential: async () => ({ token: 'controlled-observer', expiresAt: Date.now() + 86400000 }),
    report: () => undefined,
  });
  try {
    expect(observer.retainJob(819, 'existing-job', 'owner')).toBe(true);
    expect(observer.retireIssue(819)).toBe(false);
    await vi.waitFor(() => expect([...requested].sort()).toEqual(['archived-child', 'owner']));
    metadataUpdate({
      kind: 'thread.removed',
      sequence: 15,
      threadId: 'new-grandchild',
    });
    await vi.waitFor(() =>
      expect([...requested].sort()).toEqual(['archived-child', 'new-grandchild', 'owner'])
    );
    await vi.waitFor(() => expect(observer.inactive('owner', 'run')).toBe('idle'));
    observer.retainRecovery(819, 'Factory restack unseen');
    expect(observer.retireIssue(819)).toBe(false);
    metadataUpdate({
      kind: 'thread.updated',
      sequence: 20,
      thread: { ...row('new-recovery', null), title: 'Factory restack unseen' },
    });
    await vi.waitFor(() => expect(observer.inactive('new-recovery', 'run')).toBe('idle'));
    expect(observer.retireIssue(819)).toBe(true);
    await vi.waitFor(() => expect(host.connections()).toBe(1));
    expect(observer.retainJob(819, 'existing-job', 'owner')).toBe(false);
    expect(observer.inactive('owner', 'run')).toBe('busy');
  } finally {
    await observer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
