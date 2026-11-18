import { setTimeout as delay } from 'node:timers/promises';
import { Effect } from 'effect';
import { z } from 'zod';
import type { ObservationCheckpoints } from '../../capabilities/observe/index.js';
import { t3Subscription } from './subscription.js';
import {
  applyObservedEvent,
  observedActivity,
  observedThread,
  projection,
  shell,
  type Projection,
  type Shell,
} from './observed-model.js';

interface ThreadState {
  sequence: number;
  revision: number;
  value: Projection;
  ready: boolean;
}
export class ObservationUnknown extends Error {}
interface Credential {
  token: string;
  expiresAt: number;
  replaced?: AbortSignal;
}
export type T3Observations = Awaited<ReturnType<typeof t3Observations>>;

/** Shared local observations. Neither reads nor ownership registration performs external I/O. */
export async function t3Observations(config: {
  origin: string;
  checkpoints: ObservationCheckpoints;
  credential: (replace?: boolean, signal?: AbortSignal) => Promise<Credential>;
  report: (error: unknown) => void;
}) {
  const stop = new AbortController();
  const namespace = `t3:${config.origin}:`;
  const metadata = new Map<string, Shell>();
  const metadataVersions = new Map<string, number>();
  const retained = new Set<string>();
  const identities = new Set<string>();
  const details = new Map<string, ThreadState>();
  const workers = new Map<string, { stop: AbortController; work: Promise<void> }>();
  let metadataReady = false;
  let archiveReady = false;
  let metadataSequence = 0;
  let metadataRevision = 0;
  let stopped = false;
  const saved = await Effect.runPromise(config.checkpoints.read(`${namespace}inventory`));
  if (saved) {
    metadataRevision = saved.revision;
    metadataSequence = saved.sequence;
    for (const item of z.array(shell).parse(JSON.parse(saved.value))) {
      metadata.set(item.id, item);
      metadataVersions.set(item.id, saved.sequence);
    }
  }
  const checkpoint = async (key: string, revision: number, sequence: number, value: unknown) => {
    if (
      !(await Effect.runPromise(
        config.checkpoints.publish(`${namespace}${key}`, revision, {
          sequence,
          value: JSON.stringify(value),
        })
      ))
    ) {
      throw new Error('Obsolete T3 observation publication');
    }
  };
  const loop = async (signal: AbortSignal, work: (credential: Credential) => Promise<void>) => {
    let replace = false;
    while (!signal.aborted) {
      try {
        const credential = await config.credential(replace, signal);
        replace = false;
        await work(credential);
      } catch (error) {
        if (signal.aborted) break;
        replace = error instanceof Error && /HTTP (401|403)/.test(error.message);
        config.report(error);
      }
      try {
        await delay(1000, undefined, { signal });
      } catch {
        break;
      }
    }
  };
  const lifetime = (credential: Credential, signal: AbortSignal) =>
    AbortSignal.any([
      signal,
      ...(credential.replaced ? [credential.replaced] : []),
      AbortSignal.timeout(
        Math.floor(
          Math.max(
            1000,
            Math.min(
              2_147_483_647,
              credential.expiresAt -
                Date.now() -
                Math.min(86400000, Math.max(60000, (credential.expiresAt - Date.now()) / 10))
            )
          )
        )
      ),
    ]);
  const startThread = (id: string) => {
    if (workers.has(id) || stopped) return;
    const cancellation = new AbortController();
    const signal = AbortSignal.any([stop.signal, cancellation.signal]);
    const work = (async () => {
      const previous = await Effect.runPromise(config.checkpoints.read(`${namespace}thread:${id}`));
      if (previous)
        details.set(id, {
          sequence: previous.sequence,
          revision: previous.revision,
          value: projection.parse(JSON.parse(previous.value)),
          ready: false,
        });
      let forceSnapshot = false;
      await loop(signal, async (credential) => {
        const initial = details.get(id);
        if (initial) initial.ready = false;
        try {
          await t3Subscription({
            origin: config.origin,
            token: credential.token,
            signal: lifetime(credential, signal),
            requests: [
              {
                id,
                method: 'orchestration.subscribeThread',
                payload: {
                  threadId: id,
                  requestCompletionMarker: true,
                  ...(initial && !forceSnapshot ? { afterSequence: initial.sequence } : {}),
                },
              },
            ],
            apply: async (_stream, values) => {
              for (const raw of values) {
                const item = z.object({ kind: z.string() }).passthrough().parse(raw);
                const current = details.get(id);
                if (item.kind === 'synchronized') {
                  if (!current) throw new ObservationUnknown('No complete T3 thread snapshot');
                  current.ready = true;
                  forceSnapshot = false;
                  continue;
                }
                let next: Projection;
                let sequence: number;
                if (item.kind === 'snapshot') {
                  if (
                    item.hasMoreHistory === true ||
                    item.turnItemsOmitLocalVisible === true ||
                    item.payloadBudgetExceeded === true
                  )
                    throw new ObservationUnknown('Incomplete T3 thread history');
                  next = projection.parse(item.projection);
                  if (next.thread.id !== id)
                    throw new ObservationUnknown('Mismatched T3 thread snapshot');
                  sequence = z.number().int().nonnegative().parse(item.snapshotSequence);
                  if (current && sequence < current.sequence)
                    throw new ObservationUnknown('Obsolete T3 snapshot');
                } else if (item.kind === 'event' && current) {
                  sequence = z.number().int().nonnegative().parse(item.sequence);
                  if (sequence <= current.sequence) continue;
                  try {
                    next = applyObservedEvent(current.value, item.event);
                  } catch (error) {
                    forceSnapshot = true;
                    throw error;
                  }
                } else {
                  forceSnapshot = true;
                  throw new ObservationUnknown('Unsupported T3 observation');
                }
                const revision = current?.revision ?? 0;
                await checkpoint(`thread:${id}`, revision, sequence, next);
                details.set(id, {
                  revision: revision + 1,
                  sequence,
                  value: next,
                  ready: current?.ready ?? false,
                });
              }
            },
          });
        } finally {
          const current = details.get(id);
          if (current) current.ready = false;
        }
      });
    })().catch(config.report);
    workers.set(id, { stop: cancellation, work });
  };
  let lineage = new Map<string, Set<string>>();
  const select = () => {
    const roots = new Set(retained);
    for (const item of metadata.values())
      if (
        [...identities].some(
          (identity) => item.title === identity || item.title.endsWith(` ${identity}`)
        )
      )
        roots.add(item.id);
    const next = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const root of roots) {
      const owners = new Set([root]);
      for (let size = -1; size !== owners.size; ) {
        size = owners.size;
        for (const item of metadata.values())
          if (item.lineage.parentThreadId && owners.has(item.lineage.parentThreadId))
            owners.add(item.id);
      }
      next.set(root, owners);
      for (const id of owners) {
        all.add(id);
        startThread(id);
      }
    }
    lineage = next;
    for (const [id, worker] of workers)
      if (!all.has(id)) {
        worker.stop.abort();
        workers.delete(id);
      }
  };
  const inventory = loop(stop.signal, async (credential) => {
    metadataReady = false;
    let staged: Map<string, Shell> | undefined;
    let sequence = metadataSequence;
    try {
      await t3Subscription({
        origin: config.origin,
        token: credential.token,
        signal: lifetime(credential, stop.signal),
        requests: [
          {
            id: 'inventory',
            method: 'orchestration.subscribeShell',
            payload: {
              requestCompletionMarker: true,
              ...(metadataRevision ? { afterSequence: metadataSequence } : {}),
            },
          },
        ],
        apply: async (_id, values) => {
          let changed = false;
          let synchronized = metadataReady;
          for (const raw of values) {
            const item = z.object({ kind: z.string() }).passthrough().parse(raw);
            if (item.kind === 'snapshot') {
              if (item.resolvedRepositoryIdentityRoots !== undefined) continue;
              const snapshot = z
                .object({
                  snapshotSequence: z.number().int().nonnegative(),
                  threads: z.array(shell),
                  archivedThreads: z.array(shell),
                })
                .parse(item.snapshot);
              if (snapshot.snapshotSequence < metadataSequence)
                throw new ObservationUnknown('Obsolete T3 inventory');
              staged = new Map(metadata);
              for (const row of [...snapshot.threads, ...snapshot.archivedThreads]) {
                if (snapshot.snapshotSequence >= (metadataVersions.get(row.id) ?? -1)) {
                  staged.set(row.id, row);
                  metadataVersions.set(row.id, snapshot.snapshotSequence);
                }
              }
              sequence = snapshot.snapshotSequence;
              changed = true;
            } else if (item.kind === 'synchronized') {
              synchronized = true;
            } else if (item.kind === 'thread.updated') {
              const update = shell.parse(item.thread);
              const incoming = z.number().int().nonnegative().parse(item.sequence);
              if (incoming <= sequence) continue;
              staged ??= new Map(metadata);
              if (incoming >= (metadataVersions.get(update.id) ?? -1)) {
                staged.set(update.id, update);
                metadataVersions.set(update.id, incoming);
              }
              sequence = incoming;
              changed = true;
            } else if (item.kind === 'thread.removed') {
              // A location change cannot erase managed lineage or prove termination.
              const incoming = z.number().int().nonnegative().parse(item.sequence);
              if (incoming > sequence) {
                sequence = incoming;
                changed = true;
              }
            } else if (item.kind === 'project.updated' || item.kind === 'project.removed') {
              const incoming = z.number().int().nonnegative().parse(item.sequence);
              if (incoming > sequence) {
                sequence = incoming;
                changed = true;
              }
            } else throw new ObservationUnknown('Unsupported T3 inventory update');
          }
          if (changed || staged) {
            const next = staged ?? new Map(metadata);
            await checkpoint('inventory', metadataRevision, sequence, [...next.values()]);
            metadataRevision++;
            metadataSequence = sequence;
            metadata.clear();
            for (const [id, item] of next) metadata.set(id, item);
            staged = undefined;
          }
          select();
          metadataReady = synchronized;
        },
      });
    } finally {
      metadataReady = false;
    }
  }).catch(config.report);
  // The active shell excludes archived rows on bootstrap. One shared archived
  // metadata stream supplies them without fetching any conversation.
  const archived = (async () => {
    const previous = await Effect.runPromise(config.checkpoints.read(`${namespace}archive`));
    let revision = previous?.revision ?? 0;
    let sequence = previous?.sequence ?? 0;
    const rows = new Map<string, Shell>();
    const merge = () => {
      for (const row of rows.values())
        if (sequence >= (metadataVersions.get(row.id) ?? -1)) {
          metadata.set(row.id, row);
          metadataVersions.set(row.id, sequence);
        }
      select();
    };
    if (previous) {
      for (const row of z.array(shell).parse(JSON.parse(previous.value))) rows.set(row.id, row);
      merge();
    }
    await loop(stop.signal, async (credential) => {
      archiveReady = false;
      try {
        await t3Subscription({
          origin: config.origin,
          token: credential.token,
          signal: lifetime(credential, stop.signal),
          requests: [
            { id: 'archive', method: 'orchestration.subscribeArchivedShell', payload: {} },
          ],
          apply: async (_id, values) => {
            for (const raw of values) {
              const item = z.object({ kind: z.string() }).passthrough().parse(raw);
              if (item.kind === 'snapshot') {
                const snapshot = z
                  .object({
                    snapshotSequence: z.number().int().nonnegative(),
                    threads: z.array(shell),
                  })
                  .parse(item.snapshot);
                if (snapshot.snapshotSequence < sequence)
                  throw new ObservationUnknown('Obsolete T3 archive snapshot');
                rows.clear();
                for (const row of snapshot.threads) rows.set(row.id, row);
                sequence = snapshot.snapshotSequence;
              } else if (item.kind === 'thread.updated') {
                const incoming = z.number().int().nonnegative().parse(item.sequence);
                if (incoming <= sequence) continue;
                const row = shell.parse(item.thread);
                rows.set(row.id, row);
                sequence = incoming;
              } else if (item.kind === 'thread.removed') {
                continue;
              } else throw new ObservationUnknown('Unsupported T3 archived metadata');
              await checkpoint('archive', revision, sequence, [...rows.values()]);
              revision++;
              merge();
              archiveReady = true;
            }
          },
        });
      } finally {
        archiveReady = false;
      }
    });
  })().catch(config.report);
  const state = (id: string) => {
    const value = details.get(id);
    if (!value) throw new ObservationUnknown('T3 thread observation is not available');
    return value;
  };
  const activity = (id: string) => observedActivity(state(id).value, metadata.get(id));
  return {
    retain: (id: string) => {
      retained.add(id);
      select();
    },
    retainIdentity: (identity: string) => {
      identities.add(identity);
      select();
    },
    release: (id: string) => {
      retained.delete(id);
      select();
    },
    releaseIdentity: (identity: string) => {
      identities.delete(identity);
      select();
    },
    list: (projectId: string) =>
      [...metadata.values()]
        .filter((row) => row.projectId === projectId)
        .map((row) => ({ threadId: row.id, title: row.title })),
    inventoryReady: () => metadataReady && archiveReady,
    activity,
    configuration: (id: string) => ({ ...state(id).value.thread, threadId: id }),
    show: (id: string, limit: number) => ({
      thread: observedThread(state(id).value, metadata.get(id)),
      messages: activity(id)
        .items.filter((item) => item.type === 'user_message' || item.type === 'assistant_message')
        .slice(-limit)
        .map((item) => ({
          role: item.type === 'user_message' ? 'user' : 'assistant',
          ...(item.runId ? { runId: item.runId } : {}),
          text: item.text ?? '',
        })),
    }),
    links: (id: string) => ({
      pullRequests: state(id).value.thread.pullRequests ?? [],
      nextCursor: null,
    }),
    inactive: (id: string, run: string | null): 'busy' | 'waiting' | 'idle' => {
      if (!metadataReady || !archiveReady || !lineage.has(id)) return 'busy';
      let waiting = false;
      for (const owner of lineage.get(id) ?? []) {
        const value = details.get(owner);
        if (!value?.ready || metadataSequence < value.sequence) return 'busy';
        const snapshot = activity(owner);
        const meta = metadata.get(owner);
        if (
          !meta ||
          meta.blockedOnThreadWait === undefined ||
          meta.pendingBackgroundTasks === undefined ||
          (owner === id && snapshot.thread.latestRunId !== run) ||
          snapshot.thread.activeRunId ||
          !['idle', 'completed', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
            snapshot.thread.status
          ) ||
          snapshot.thread.pendingRequestCount ||
          meta.pendingBackgroundTasks.length ||
          snapshot.items.some((item) => ['pending', 'running', 'waiting'].includes(item.status))
        )
          return 'busy';
        waiting ||=
          meta.blockedOnThreadWait ||
          (meta.pullRequests?.some((pr) => pr.watching === true || pr.watch != null) ?? false);
      }
      return waiting ? 'waiting' : 'idle';
    },
    close: async () => {
      stopped = true;
      stop.abort();
      await Promise.allSettled([
        inventory,
        archived,
        ...[...workers.values()].map((worker) => worker.work),
      ]);
    },
  };
}
