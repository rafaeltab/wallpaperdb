import { setTimeout as delay } from 'node:timers/promises';
import { Effect } from 'effect';
import { z } from 'zod';
import type { ObservationCheckpoints } from '../../capabilities/observe/index.js';
import { t3Subscription, t3ReadRpc } from './subscription.js';
import { decodeObservation, observationEncoding } from './observation-checkpoint.js';
import {
  applyObservedEvent,
  observedActivity,
  observedThread,
  projection,
  shell,
  type Projection,
  type Shell,
} from './observed-model.js';

import { t3CompleteSnapshot } from './complete-snapshot.js';
import { t3FamilyFreshness } from './observation-freshness.js';

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
interface ManagedIssue {
  jobs: Set<string>;
  recoveries: Set<string>;
  owners: Set<string>;
}
export type T3Observations = Awaited<ReturnType<typeof t3Observations>>;

/** Shared local observations. Neither reads nor ownership registration performs external I/O. */
export async function t3Observations(config: {
  origin: string;
  checkpoints: ObservationCheckpoints;
  credential: (replace?: boolean, signal?: AbortSignal) => Promise<Credential>;
  report: (error: unknown) => void;
  run?: <A>(operation: Effect.Effect<A, unknown>) => Promise<A>;
}) {
  const run = config.run ?? Effect.runPromise;
  const stop = new AbortController();
  const namespace = `t3:${config.origin}:`;
  const metadata = new Map<string, Shell>();
  const metadataVersions = new Map<string, number>();
  const retained = new Set<string>();
  const identities = new Set<string>();
  const managed = new Map<number, ManagedIssue>();
  const retiredJobs = new Set<string>();
  const retiredRecoveries = new Set<string>();
  const retiredRoots = new Set<string>();
  const details = new Map<string, ThreadState>();
  const workers = new Map<string, { stop: AbortController; work: Promise<void> }>();
  let metadataReady = false;
  let archiveReady = false;
  let metadataSequence = 0;
  let metadataRevision = 0;
  let metadataResume = false;
  let stopped = false;
  const saved = await run(config.checkpoints.read(`${namespace}inventory`));
  if (saved) {
    metadataRevision = saved.revision;
    metadataSequence = saved.sequence;
    try {
      for (const item of z.array(shell).parse(decodeObservation(saved))) {
        metadata.set(item.id, item);
        metadataVersions.set(item.id, saved.sequence);
      }
      metadataResume = true;
    } catch {
      config.report(
        new ObservationUnknown('Unusable T3 inventory checkpoint; requesting a snapshot')
      );
    }
  }
  const encodings = new Map<string, ReturnType<typeof observationEncoding>>();
  const checkpoint = async (
    key: string,
    revision: number,
    sequence: number,
    value: Projection | Shell[]
  ) => {
    let encode = encodings.get(key);
    if (!encode) {
      encode = observationEncoding();
      encodings.set(key, encode);
    }
    const encoded = encode(value);
    if (
      !(await run(
        config.checkpoints.publish(`${namespace}${key}`, revision, {
          sequence,
          value: encoded.value,
          entities: encoded.entities,
          replaceEntities: encoded.replaceEntities,
        })
      ))
    ) {
      throw new Error('Obsolete T3 observation publication');
    }
    encoded.committed();
  };
  const loop = async (signal: AbortSignal, work: (credential: Credential) => Promise<void>) => {
    let replace = false;
    while (!signal.aborted) {
      try {
        await run(
          Effect.tryPromise({
            try: async () => {
              const credential = await config.credential(replace, signal);
              replace = false;
              await work(credential);
            },
            catch: (cause) => cause,
          }).pipe(Effect.withSpan('factory.t3.observation.synchronize'))
        );
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
  const restoreCheckpoint = async (stream: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        return await run(config.checkpoints.read(`${namespace}${stream}`));
      } catch (error) {
        if (!signal.aborted) config.report(error);
      }
      try {
        await delay(1000, undefined, { signal });
      } catch {
        break;
      }
    }
    return null;
  };
  const freshness = t3FamilyFreshness({
    signal: stop.signal,
    report: config.report,
    read: (root) =>
      run(
        Effect.tryPromise({
          try: async () => {
            const credential = await config.credential(false, stop.signal);
            try {
              return await t3ReadRpc({
                origin: config.origin,
                token: credential.token,
                signal: lifetime(credential, stop.signal),
                method: 'orchestration.getThreadFamily',
                payload: { threadId: root },
              });
            } catch (error) {
              if (error instanceof Error && /HTTP (401|403)/.test(error.message))
                await config.credential(true, stop.signal);
              throw error;
            }
          },
          catch: (cause) => cause,
        }).pipe(Effect.withSpan('factory.t3.observation.family'))
      ),
  });
  const startThread = (id: string) => {
    if (workers.has(id) || stopped) return;
    const cancellation = new AbortController();
    const signal = AbortSignal.any([stop.signal, cancellation.signal]);
    const work = (async () => {
      const previous = await restoreCheckpoint(`thread:${id}`, signal);
      let revision = previous?.revision ?? 0;
      let forceSnapshot = false;
      if (previous)
        try {
          details.set(id, {
            sequence: previous.sequence,
            revision: previous.revision,
            value: projection.parse(decodeObservation(previous)),
            ready: false,
          });
        } catch {
          forceSnapshot = true;
          config.report(
            new ObservationUnknown('Unusable managed T3 checkpoint; requesting a snapshot')
          );
        }
      await loop(signal, async (credential) => {
        const initial = details.get(id);
        if (initial) initial.ready = false;
        const streamStop = new AbortController();
        const streamSignal = AbortSignal.any([signal, streamStop.signal]);
        try {
          await t3Subscription({
            origin: config.origin,
            token: credential.token,
            signal: lifetime(credential, streamSignal),
            requests: [
              {
                id,
                method: 'orchestration.subscribeThread',
                payload: {
                  threadId: id,
                  requestCompletionMarker: true,
                  acceptBoundedSnapshot: true,
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
                  ) {
                    const recovered = await run(
                      Effect.tryPromise({
                        try: () =>
                          t3CompleteSnapshot({
                            origin: config.origin,
                            token: credential.token,
                            signal: lifetime(credential, streamSignal),
                            threadId: id,
                          }),
                        catch: (cause) => cause,
                      }).pipe(Effect.withSpan('factory.t3.observation.history'))
                    );
                    const boundedSequence = z
                      .number()
                      .int()
                      .nonnegative()
                      .parse(item.snapshotSequence);
                    if (
                      recovered.snapshotSequence < Math.max(boundedSequence, current?.sequence ?? 0)
                    )
                      throw new ObservationUnknown('Obsolete complete T3 thread snapshot');
                    signal.throwIfAborted();
                    await checkpoint(
                      `thread:${id}`,
                      revision,
                      recovered.snapshotSequence,
                      recovered.projection
                    );
                    revision++;
                    details.set(id, {
                      revision,
                      sequence: recovered.snapshotSequence,
                      value: recovered.projection,
                      ready: false,
                    });
                    forceSnapshot = false;
                    // Reconnect at the recovered cursor. The bounded stream's marker
                    // cannot prove that the replacement snapshot has synchronized.
                    streamStop.abort();
                    return;
                  }
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
                await checkpoint(`thread:${id}`, revision, sequence, next);
                revision++;
                details.set(id, {
                  revision,
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
  const issueRoots = (group: ManagedIssue) => {
    const roots = new Set(group.owners);
    for (const item of metadata.values()) {
      const tag = /\[factory:(.+)\]$/.exec(item.title)?.[1];
      if (
        group.recoveries.has(item.title) ||
        [...group.jobs].some(
          (id) =>
            tag === id ||
            tag?.startsWith(`${id}:retry-`) ||
            item.title === `Factory ${id}` ||
            item.title.startsWith(`Factory ${id}:retry-`)
        )
      )
        roots.add(item.id);
    }
    return roots;
  };
  const select = () => {
    const roots = new Set(retained);
    for (const group of managed.values()) for (const id of issueRoots(group)) roots.add(id);
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
              ...(metadataResume ? { afterSequence: metadataSequence } : {}),
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
              const present = new Set(
                [...snapshot.threads, ...snapshot.archivedThreads].map((row) => row.id)
              );
              for (const row of metadata.values())
                if (
                  !present.has(row.id) &&
                  row.archivedAt == null &&
                  snapshot.snapshotSequence >= (metadataVersions.get(row.id) ?? -1)
                ) {
                  staged.set(row.id, { ...row, observationMissing: true });
                  metadataVersions.set(row.id, snapshot.snapshotSequence);
                }
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
              // The installed shell reports archived changes as active removals.
              // Refine that identity through metadata, never an unrelated transcript.
              const incoming = z.number().int().nonnegative().parse(item.sequence);
              if (incoming > sequence) {
                const family = z
                  .object({
                    snapshotSequence: z.number().int().nonnegative(),
                    threads: z.array(shell),
                  })
                  .parse(
                    await t3ReadRpc({
                      origin: config.origin,
                      token: credential.token,
                      signal: lifetime(credential, stop.signal),
                      method: 'orchestration.getThreadFamily',
                      payload: { threadId: z.string().parse(item.threadId) },
                    })
                  );
                staged ??= new Map(metadata);
                const removed = metadata.get(z.string().parse(item.threadId));
                if (
                  removed &&
                  !family.threads.some((row) => row.id === removed.id) &&
                  incoming >= (metadataVersions.get(removed.id) ?? -1)
                ) {
                  staged.set(removed.id, { ...removed, observationMissing: true });
                  metadataVersions.set(removed.id, incoming);
                }
                for (const row of family.threads)
                  if (family.snapshotSequence >= (metadataVersions.get(row.id) ?? -1)) {
                    staged.set(row.id, row);
                    metadataVersions.set(row.id, family.snapshotSequence);
                  }
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
            metadataResume = true;
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
  // The installed runtime exposes archived bootstrap metadata as a single-response
  // RPC. Incremental archived changes arrive on the shared shell as removals.
  const archived = (async () => {
    const previous = await restoreCheckpoint('archive', stop.signal);
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
    if (previous)
      try {
        for (const row of z.array(shell).parse(decodeObservation(previous))) rows.set(row.id, row);
        merge();
      } catch {
        config.report(
          new ObservationUnknown('Unusable archived T3 checkpoint; requesting a snapshot')
        );
      }
    await loop(stop.signal, async (credential) => {
      const nextAt = Date.now() + 900000;
      const snapshot = z
        .object({ snapshotSequence: z.number().int().nonnegative(), threads: z.array(shell) })
        .parse(
          await t3ReadRpc({
            origin: config.origin,
            token: credential.token,
            signal: lifetime(credential, stop.signal),
            method: 'orchestration.getArchivedShellSnapshot',
            payload: {},
          })
        );
      if (snapshot.snapshotSequence < sequence)
        throw new ObservationUnknown('Obsolete T3 archive snapshot');
      rows.clear();
      for (const row of snapshot.threads) rows.set(row.id, row);
      sequence = snapshot.snapshotSequence;
      await checkpoint('archive', revision, sequence, [...rows.values()]);
      revision++;
      merge();
      archiveReady = true;
      await delay(Math.max(0, nextAt - Date.now() - 1000), undefined, { signal: stop.signal });
    });
  })().catch(config.report);
  const state = (id: string) => {
    const value = details.get(id);
    if (!value) throw new ObservationUnknown('T3 thread observation is not available');
    return value;
  };
  const activity = (id: string) => observedActivity(state(id).value, metadata.get(id));
  const candidate = (id: string, run: string | null) => {
    if (!metadataReady || !archiveReady || !lineage.has(id)) return undefined;
    let waiting = false;
    let sequence = 0;
    const rows: Shell[] = [];
    for (const owner of lineage.get(id) ?? []) {
      const value = details.get(owner);
      if (!value?.ready) return undefined;
      const snapshot = activity(owner);
      const meta = metadata.get(owner);
      if (
        !meta ||
        meta.observationMissing === true ||
        meta.blockedOnThreadWait === undefined ||
        meta.pendingBackgroundTasks === undefined ||
        meta.pullRequests === undefined ||
        meta.latestRunId !== snapshot.thread.latestRunId ||
        meta.activeRunId !== null ||
        (owner === id && snapshot.thread.latestRunId !== run) ||
        snapshot.thread.activeRunId ||
        !['idle', 'completed', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
          snapshot.thread.status
        ) ||
        snapshot.thread.pendingRequestCount ||
        meta.pendingBackgroundTasks.length ||
        snapshot.items.some((item) => ['pending', 'running', 'waiting'].includes(item.status))
      )
        return undefined;
      sequence = Math.max(sequence, value.sequence);
      rows.push(meta);
      waiting ||=
        meta.blockedOnThreadWait ||
        meta.pullRequests.some((pr) => pr.watching === true || pr.watch != null);
    }
    return { sequence, rows, waiting };
  };
  const inactive = (id: string, run: string | null): 'busy' | 'waiting' | 'idle' => {
    const value = candidate(id, run);
    if (
      !value ||
      (metadataSequence < value.sequence && !freshness.synchronized(id, value.sequence, value.rows))
    )
      return 'busy';
    return value.waiting ? 'waiting' : 'idle';
  };
  const confirmations = (async () => {
    while (!stop.signal.aborted) {
      for (const id of lineage.keys()) {
        const current = details.get(id);
        if (!current) continue;
        const value = candidate(id, observedThread(current.value).latestRunId);
        if (
          value &&
          metadataSequence < value.sequence &&
          !freshness.synchronized(id, value.sequence, value.rows)
        )
          freshness.refresh(id);
      }
      try {
        await delay(1000, undefined, { signal: stop.signal });
      } catch {
        break;
      }
    }
  })().catch(config.report);
  const groupFor = (issue: number) => {
    let group = managed.get(issue);
    if (!group) {
      group = { jobs: new Set(), recoveries: new Set(), owners: new Set() };
      managed.set(issue, group);
    }
    return group;
  };
  return {
    retainJob: (issue: number, id: string, owner?: string) => {
      if (retiredJobs.has(id)) return false;
      const group = groupFor(issue);
      const changed = !group.jobs.has(id) || Boolean(owner && !group.owners.has(owner));
      group.jobs.add(id);
      if (owner) {
        group.owners.add(owner);
        retiredRoots.delete(owner);
      }
      if (changed) select();
      return changed;
    },
    retainRecovery: (issue: number, title: string) => {
      if (retiredRecoveries.has(title)) return;
      const group = groupFor(issue);
      if (group.recoveries.has(title)) return;
      group.recoveries.add(title);
      select();
    },
    retainForIssue: (issue: number, owner: string) => {
      const group = managed.get(issue);
      if (!group || group.owners.has(owner)) return;
      group.owners.add(owner);
      retiredRoots.delete(owner);
      select();
    },
    retireIssue: (issue: number) => {
      const group = managed.get(issue);
      if (!group) return false;
      if (
        [...group.recoveries].some(
          (title) => [...metadata.values()].filter((row) => row.title === title).length !== 1
        )
      )
        return false;
      const roots = issueRoots(group);
      if (
        !roots.size ||
        [...roots].some(
          (id) =>
            !details.has(id) || inactive(id, observedThread(state(id).value).latestRunId) !== 'idle'
        )
      )
        return false;
      for (const id of group.jobs) retiredJobs.add(id);
      for (const title of group.recoveries) retiredRecoveries.add(title);
      for (const id of roots) retiredRoots.add(id);
      managed.delete(issue);
      select();
      return true;
    },
    retain: (id: string) => {
      if (retained.has(id)) return;
      retiredRoots.delete(id);
      retained.add(id);
      select();
    },
    retainIdentity: (identity: string) => {
      if (identities.has(identity)) return;
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
        .filter((row) => row.projectId === projectId && row.observationMissing !== true)
        .map((row) => ({ threadId: row.id, title: row.title })),
    inventoryReady: () => metadataReady && archiveReady,
    activity,
    configuration: (id: string) => ({ ...state(id).value.thread, threadId: id }),
    show: (id: string, limit: number) => {
      const meta = metadata.get(id);
      const thread = observedThread(state(id).value, meta);
      if (
        !retiredRoots.has(id) &&
        meta &&
        (meta.observationMissing === true ||
          meta.latestRunId !== thread.latestRunId ||
          meta.activeRunId !== thread.activeRunId ||
          meta.projectId !== thread.projectId ||
          meta.title !== thread.title)
      )
        throw new ObservationUnknown('T3 thread detail is catching up with metadata');
      return {
        thread,
        messages: activity(id)
          .items.filter((item) => item.type === 'user_message' || item.type === 'assistant_message')
          .slice(-limit)
          .map((item) => ({
            role: item.type === 'user_message' ? 'user' : 'assistant',
            ...(item.runId ? { runId: item.runId } : {}),
            text: item.text ?? '',
          })),
      };
    },
    links: (id: string) => ({
      pullRequests: state(id).value.thread.pullRequests ?? [],
      nextCursor: null,
    }),
    inactive,
    close: async () => {
      stopped = true;
      stop.abort();
      await Promise.allSettled([
        inventory,
        archived,
        freshness.close(),
        confirmations,
        ...[...workers.values()].map((worker) => worker.work),
      ]);
    },
  };
}
