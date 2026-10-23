import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Clock, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import { observeCleanup } from './telemetry.js';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
  CleanupStore,
  CleanupFailure,
  type CleanupWork,
} from '../../capabilities/cleanup/index.js';
import {
  sourceCleanup,
  ownedAssets,
  assetSourceState,
  immutableSources,
  assetDeletions,
  sourceReads,
} from '../../db/schema.js';

interface Options {
  readonly databaseUrl: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
}
type Database = ReturnType<typeof drizzle>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
async function finishDeletedAsset(tx: Transaction, assetId: string) {
  const [terminal] = await tx
    .select({ id: assetDeletions.assetId })
    .from(assetDeletions)
    .where(eq(assetDeletions.assetId, assetId));
  if (!terminal) return;
  const pending = await tx
    .select({ id: sourceCleanup.id })
    .from(sourceCleanup)
    .where(and(eq(sourceCleanup.assetId, assetId), sql`${sourceCleanup.status} <> 'completed'`))
    .limit(1);
  if (pending.length) return;
  await tx
    .update(assetDeletions)
    .set({ cleanupPending: false })
    .where(eq(assetDeletions.assetId, assetId));
  await tx.delete(assetSourceState).where(eq(assetSourceState.assetId, assetId));
  await tx.delete(sourceReads).where(eq(sourceReads.assetId, assetId));
}
export function cleanupPostgresLayer(options: Options) {
  return Layer.effect(
    CleanupStore,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new Pool({
            connectionString: options.databaseUrl,
            max: 4,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
          });
          pool.on('error', (cause) =>
            logs.getLogger('asset.cleanup').emit({
              severityNumber: SeverityNumber.ERROR,
              body: 'Idle cleanup database connection failed',
              attributes: { 'error.type': cause.name, 'error.message': cause.message },
            })
          );
          return pool;
        }),
        (pool) => Effect.promise(() => pool.end())
      );
      const run = <A>(operation: string, work: (db: ReturnType<typeof drizzle>) => Promise<A>) =>
        Effect.tryPromise({
          try: async (signal) => {
            const client = await pool.connect();
            let failed = false;
            const onError = () => {
              failed = true;
            };
            client.on('error', onError);
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
            let released = false;
            const abort = () => {
              if (!released) {
                released = true;
                client.release(true);
              }
            };
            deadline.addEventListener('abort', abort, { once: true });
            try {
              if (deadline.aborted) {
                abort();
                throw new Error('Cleanup cancelled');
              }
              return await work(drizzle(client));
            } finally {
              deadline.removeEventListener('abort', abort);
              if (!released) client.release(failed);
              client.off('error', onError);
            }
          },
          catch: (cause) => new CleanupFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Cleanup persistence failed', { operation, cause: error.cause })
          ),
          Effect.withSpan(`asset.cleanup.database.${operation}`)
        );
      const identity = (row: typeof sourceCleanup.$inferSelect) => ({
        id: row.id,
        assetId: row.assetId,
        target: row.target,
        attempts: row.attempts,
        context: row.context ?? undefined,
        leaseId: row.leaseId ?? undefined,
      });
      const match = (work: CleanupWork) =>
        and(
          eq(sourceCleanup.id, work.id),
          eq(sourceCleanup.leaseId, work.leaseId),
          eq(sourceCleanup.status, 'reclaiming')
        );
      return {
        claim: (limit) =>
          Effect.gen(function* () {
            const now = new Date(yield* Clock.currentTimeMillis);
            const transitions = yield* run('claim', async (db) => {
              const expiredReads = await db
                .select({ id: sourceReads.id })
                .from(sourceReads)
                .where(lte(sourceReads.expiresAt, now))
                .limit(100);
              if (expiredReads.length)
                await db.delete(sourceReads).where(
                  inArray(
                    sourceReads.id,
                    expiredReads.map((read) => read.id)
                  )
                );
              const finished = await db
                .select({ assetId: assetDeletions.assetId })
                .from(assetDeletions)
                .where(
                  and(
                    eq(assetDeletions.cleanupPending, true),
                    sql`NOT EXISTS (SELECT 1 FROM ${sourceCleanup} WHERE ${sourceCleanup.assetId} = ${assetDeletions.assetId} AND ${sourceCleanup.status} <> 'completed')`
                  )
                )
                .limit(100);
              for (const asset of finished)
                await db.transaction(async (tx) => {
                  await tx
                    .select()
                    .from(ownedAssets)
                    .where(eq(ownedAssets.id, asset.assetId))
                    .for('update');
                  await finishDeletedAsset(tx, asset.assetId);
                });
              const candidates = await db
                .select()
                .from(sourceCleanup)
                .where(
                  and(
                    inArray(sourceCleanup.status, ['pending', 'reclaiming']),
                    lte(sourceCleanup.dueAt, now),
                    lte(sourceCleanup.availableAt, now)
                  )
                )
                .orderBy(asc(sourceCleanup.dueAt), asc(sourceCleanup.id))
                .limit(Math.max(1, Math.min(100, limit)));
              const result: (
                | { readonly outcome: 'claimed'; readonly work: CleanupWork }
                | { readonly outcome: 'quarantined'; readonly work: ReturnType<typeof identity> }
              )[] = [];
              for (const candidate of candidates) {
                const transition = await db.transaction(async (tx) => {
                  await tx
                    .select()
                    .from(ownedAssets)
                    .where(eq(ownedAssets.id, candidate.assetId))
                    .for('update');
                  const [row] = await tx
                    .select()
                    .from(sourceCleanup)
                    .where(eq(sourceCleanup.id, candidate.id))
                    .for('update', { skipLocked: true });
                  if (
                    !row ||
                    !['pending', 'reclaiming'].includes(row.status) ||
                    !row.dueAt ||
                    row.dueAt > now ||
                    row.availableAt > now
                  )
                    return null;
                  const target = row.target;
                  if (target.kind === 'source') {
                    const protectedReads = await tx
                      .select({ id: sourceReads.id })
                      .from(sourceReads)
                      .where(
                        and(
                          eq(sourceReads.assetId, row.assetId),
                          eq(sourceReads.sourceId, target.sourceId),
                          gt(sourceReads.expiresAt, now)
                        )
                      )
                      .limit(1);
                    if (protectedReads.length) return null;
                    await tx
                      .delete(sourceReads)
                      .where(
                        and(
                          eq(sourceReads.assetId, row.assetId),
                          eq(sourceReads.sourceId, target.sourceId),
                          lte(sourceReads.expiresAt, now)
                        )
                      );
                  }
                  const [record] = await tx
                    .select()
                    .from(assetSourceState)
                    .where(eq(assetSourceState.assetId, row.assetId));
                  if (
                    target.kind === 'source' &&
                    record?.state.sources.some((source) => source.sourceId === target.sourceId)
                  )
                    return null;
                  if (row.attempts >= options.maxAttempts) {
                    await tx
                      .update(sourceCleanup)
                      .set({ status: 'quarantined', leaseId: null })
                      .where(eq(sourceCleanup.id, row.id));
                    return { outcome: 'quarantined' as const, work: identity(row) };
                  }
                  if (record) {
                    const state = record.state;
                    for (const pending of state.candidates) {
                      if (
                        pending.candidateId !==
                          (row.target.kind === 'candidate' ? row.target.candidateId : undefined) &&
                        pending.sourceId !==
                          (row.target.kind === 'source' ? row.target.sourceId : undefined)
                      )
                        continue;
                      if (!['accepted', 'rejected', 'cancelled'].includes(pending.status)) {
                        pending.status = 'rejected';
                        pending.reason =
                          Date.parse(pending.expiresAt) <= now.getTime()
                            ? 'candidate-expired'
                            : 'temporary-input-expired';
                        state.nonterminalCandidateCount--;
                        await tx
                          .update(sourceCleanup)
                          .set({ dueAt: sql`least(${sourceCleanup.dueAt}, ${now})` })
                          .where(
                            inArray(sourceCleanup.id, [
                              `candidate:${pending.candidateId}`,
                              `source:${pending.sourceId}`,
                            ])
                          );
                      }
                    }
                    await tx
                      .update(assetSourceState)
                      .set({ state })
                      .where(eq(assetSourceState.assetId, row.assetId));
                  }
                  const leaseId = randomUUID();
                  await tx
                    .update(sourceCleanup)
                    .set({
                      status: 'reclaiming',
                      attempts: row.attempts + 1,
                      leaseId,
                      availableAt: new Date(now.getTime() + options.leaseMs),
                    })
                    .where(eq(sourceCleanup.id, row.id));
                  return {
                    outcome: 'claimed' as const,
                    work: { ...identity(row), leaseId, attempts: row.attempts + 1 },
                  };
                });
                if (transition) result.push(transition);
              }
              return result;
            });
            const claimed: CleanupWork[] = [];
            for (const transition of transitions) {
              yield* observeCleanup(
                transition.outcome === 'quarantined'
                  ? 'asset.cleanup.quarantine'
                  : 'asset.cleanup.claim',
                transition.work,
                Effect.succeed(transition.outcome)
              );
              if (transition.outcome === 'claimed') claimed.push(transition.work);
            }
            return claimed;
          }),
        completed: (work) =>
          observeCleanup(
            'asset.cleanup.complete',
            work,
            run('completed', (db) =>
              db.transaction(async (tx) => {
                const [entry] = await tx
                  .select({ assetId: sourceCleanup.assetId })
                  .from(sourceCleanup)
                  .where(eq(sourceCleanup.id, work.id));
                if (!entry) return 'stale-claim';
                await tx
                  .select()
                  .from(ownedAssets)
                  .where(eq(ownedAssets.id, entry.assetId))
                  .for('update');
                const rows = await tx
                  .update(sourceCleanup)
                  .set({ status: 'completed', leaseId: null })
                  .where(match(work))
                  .returning({ assetId: sourceCleanup.assetId });
                if (!rows[0]) return 'stale-claim';
                if (work.target.kind === 'source')
                  await tx
                    .delete(immutableSources)
                    .where(
                      and(
                        eq(immutableSources.id, work.target.sourceId),
                        eq(immutableSources.assetId, work.target.assetId)
                      )
                    );
                await finishDeletedAsset(tx, rows[0].assetId);
                return 'completed';
              })
            )
          ).pipe(Effect.asVoid),
        failed: (work) =>
          observeCleanup(
            'asset.cleanup.fail',
            work,
            run('failed', async (db) => {
              const rows = await db
                .update(sourceCleanup)
                .set({
                  status: work.attempts >= options.maxAttempts ? 'quarantined' : 'pending',
                  leaseId: null,
                  availableAt: new Date(
                    Date.now() + Math.min(30000, options.retryDelayMs * 2 ** (work.attempts - 1))
                  ),
                })
                .where(match(work))
                .returning({ id: sourceCleanup.id });
              return rows.length
                ? work.attempts >= options.maxAttempts
                  ? 'quarantined'
                  : 'retry-recorded'
                : 'stale-claim';
            })
          ).pipe(Effect.asVoid),
        pendingAlerts: () =>
          run('pending-alerts', async (db) =>
            (
              await db
                .select()
                .from(sourceCleanup)
                .where(
                  and(eq(sourceCleanup.status, 'quarantined'), isNull(sourceCleanup.notifiedAt))
                )
                .limit(100)
            ).map((row) => ({
              ...identity(row),
              applicationId: row.applicationId,
              notificationId: row.notificationId,
            }))
          ),
        alerted: (id, notificationId) =>
          Effect.gen(function* () {
            const [row] = yield* run('inspect-alert', (db) =>
              db.select().from(sourceCleanup).where(eq(sourceCleanup.id, id))
            );
            if (!row) return;
            yield* observeCleanup(
              'asset.cleanup.confirm-notification',
              identity(row),
              run('alerted', async (db) => {
                const rows = await db
                  .update(sourceCleanup)
                  .set({ notifiedAt: new Date() })
                  .where(
                    and(
                      eq(sourceCleanup.id, id),
                      eq(sourceCleanup.notificationId, notificationId),
                      eq(sourceCleanup.status, 'quarantined')
                    )
                  )
                  .returning({ id: sourceCleanup.id });
                return rows.length ? 'notified' : 'stale-notification';
              }),
              { 'cleanup.notification_id': notificationId }
            );
          }),
        recover: (id) =>
          Effect.gen(function* () {
            const [row] = yield* run('inspect-recovery', (db) =>
              db.select().from(sourceCleanup).where(eq(sourceCleanup.id, id))
            );
            if (!row) return false;
            const outcome = yield* observeCleanup(
              'asset.cleanup.recover',
              identity(row),
              run('recover', async (db) => {
                const rows = await db
                  .update(sourceCleanup)
                  .set({
                    status: 'pending',
                    attempts: 0,
                    leaseId: null,
                    availableAt: new Date(),
                    notifiedAt: null,
                    notificationId: randomUUID(),
                  })
                  .where(and(eq(sourceCleanup.id, id), eq(sourceCleanup.status, 'quarantined')))
                  .returning({ id: sourceCleanup.id });
                return rows.length ? 'recovered' : 'unavailable';
              }),
              { 'cleanup.notification_id': row.notificationId }
            );
            return outcome === 'recovered';
          }),
      };
    })
  );
}
