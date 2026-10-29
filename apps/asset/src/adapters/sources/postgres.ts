import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, desc, gt, lt, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { observeWorkflow } from '../commands/index.js';
import {
  SourceStore,
  SourceAcceptanceOutbox,
  SourceFailure,
  type SourceState,
  type SourceStorePort,
  type SourcePublication,
  type SourceAcceptanceOutboxPort,
} from '../../capabilities/sources/index.js';
import {
  assetConfiguration,
  ownedAssets,
  assetSourceState,
  immutableSources,
  sourceAcceptanceOutbox,
  sourceCleanup,
  sourceReads,
  sourceCandidates,
} from '../../db/schema.js';
interface Options {
  readonly databaseUrl: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
}
class SourceDecisionDefect {
  constructor(readonly cause: unknown) {}
}
function decide<A>(change: () => A): A {
  try {
    return change();
  } catch (cause) {
    throw new SourceDecisionDefect(cause);
  }
}
export function sourcePostgresLayer(options: Options) {
  return Layer.effectContext(
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
            logs.getLogger('asset.sources').emit({
              severityNumber: SeverityNumber.ERROR,
              body: 'Idle Source database connection failed',
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
            let released = false;
            let connectionFailure: Error | undefined;
            // pg also emits errors on borrowed clients, outside query rejection.
            const connectionError = (cause: Error) => {
              connectionFailure = cause;
            };
            client.on('error', connectionError);
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
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
                throw new Error('Source operation cancelled');
              }
              const result = await work(drizzle(client));
              if (connectionFailure) throw connectionFailure;
              return result;
            } finally {
              deadline.removeEventListener('abort', abort);
              if (!released) client.release(connectionFailure !== undefined);
              client.off('error', connectionError);
            }
          },
          catch: (cause) => new SourceFailure({ operation, cause }),
        }).pipe(
          Effect.catchTag('SourceFailure', (failure) =>
            failure.cause instanceof SourceDecisionDefect
              ? Effect.die(failure.cause.cause)
              : Effect.fail(failure)
          ),
          Effect.tapError((error) =>
            Effect.logError('Source persistence failed', { operation, cause: error.cause })
          ),
          Effect.withSpan(`asset.sources.database.${operation}`)
        );
      const store: SourceStorePort = {
        releaseRead: (id) =>
          run('release-read', async (db) => {
            await db.delete(sourceReads).where(eq(sourceReads.id, id));
          }),
        transact: (assetId, revision, change, selection = { kind: 'page' }) =>
          run('transact', (db) =>
            db.transaction(async (tx) => {
              if (revision !== null) {
                const [active] = await tx
                  .select()
                  .from(assetConfiguration)
                  .where(eq(assetConfiguration.id, 1))
                  .for('share');
                if (active?.revision !== revision) throw new Error('Inactive Source policy');
              }
              const [asset] = await tx
                .select()
                .from(ownedAssets)
                .where(eq(ownedAssets.id, assetId))
                .for('update');
              const [record] = await tx
                .select()
                .from(assetSourceState)
                .where(eq(assetSourceState.assetId, assetId));
              const initial: SourceState | null =
                asset && asset.deletedAt === null
                  ? (record?.state ?? {
                      asset: {
                        id: asset.id,
                        applicationId: asset.applicationId,
                        assetType: asset.assetType,
                        owner: { namespace: asset.ownerNamespace, subject: asset.ownerSubject },
                      },
                      sourceSetRevision: '0',
                      deliveryRevision: '0',
                      defaultSourceId: null,
                      initialAnalysisSourceId: null,
                      sources: [],
                      candidates: [],
                      nonterminalCandidateCount: 0,
                    })
                  : null;
              if (initial) {
                initial.candidateSequence ??= 0;
                if (initial.candidates.length) throw new Error('Source history migration required');
                const predicates = [eq(sourceCandidates.assetId, assetId)];
                if (selection.kind === 'candidate')
                  predicates.push(eq(sourceCandidates.id, selection.id));
                if (selection.kind === 'replay') {
                  predicates.push(eq(sourceCandidates.replayKey, selection.key));
                  const [live] = await tx
                    .select({ count: sql<number>`count(*)::int` })
                    .from(sourceCandidates)
                    .where(
                      and(
                        eq(sourceCandidates.assetId, assetId),
                        gt(sourceCandidates.liveUntil, new Date(selection.now))
                      )
                    );
                  initial.liveCandidateCount = live?.count ?? 0;
                }
                let end = initial.candidateSequence ?? 0;
                let valid = true;
                if (selection.kind === 'page' && selection.cursor !== undefined) {
                  const match = /^(0|[1-9][0-9]*):(.+)$/.exec(selection.cursor);
                  end = match ? Number(match[1]) : -1;
                  if (!Number.isSafeInteger(end) || end < 0 || selection.cursor.length > 256)
                    valid = false;
                  else {
                    const [anchor] = await tx
                      .select({ id: sourceCandidates.id })
                      .from(sourceCandidates)
                      .where(
                        and(
                          eq(sourceCandidates.assetId, assetId),
                          eq(sourceCandidates.position, end)
                        )
                      );
                    valid = anchor?.id === match?.[2];
                  }
                }
                if (selection.kind === 'page')
                  predicates.push(lt(sourceCandidates.position, valid ? end : 0));
                const rows = await tx
                  .select()
                  .from(sourceCandidates)
                  .where(and(...predicates))
                  .orderBy(desc(sourceCandidates.position))
                  .limit(selection.kind === 'page' ? 32 : 1);
                initial.candidates = rows.reverse().map((row) => row.candidate);
                if (selection.kind === 'page')
                  initial.candidateWindow = { start: rows[0]?.position ?? 0, valid };
              }
              const priorSources = initial?.sources.map((source) => source.sourceId) ?? [];
              const priorValues = new Map(
                initial?.candidates.map((candidate) => [
                  candidate.candidateId,
                  structuredClone(candidate),
                ])
              );
              const priorCandidates = new Map(
                initial?.candidates.map((candidate) => [candidate.candidateId, candidate.status])
              );
              const changed = decide(() => {
                const changed = change(initial);
                if (changed.state && (!asset || asset.deletedAt !== null))
                  throw new Error('Unavailable Asset cannot accept Source state');
                const protection = changed.readProtection;
                if (
                  protection &&
                  !initial?.sources.some((source) => source.sourceId === protection.sourceId)
                )
                  throw new Error('Read protection requires active membership');
                return changed;
              });
              if (changed.readProtection) {
                const protection = changed.readProtection;
                await tx.insert(sourceReads).values({
                  id: protection.readId,
                  assetId,
                  sourceId: protection.sourceId,
                  expiresAt: new Date(protection.expiresAt),
                });
              }
              if (changed.state && asset) {
                for (const candidate of changed.state.candidates) {
                  if (priorCandidates.get(candidate.candidateId) === candidate.status) continue;
                  const terminal = ['accepted', 'rejected', 'cancelled'].includes(candidate.status);
                  const context = changed.cleanupContext ?? candidate.context;
                  const inputExpiry = Math.min(
                    Date.parse(candidate.expiresAt),
                    Date.parse(candidate.temporaryExpiresAt ?? candidate.expiresAt)
                  );
                  const inputDue = new Date(
                    terminal ? Math.min(Date.now(), inputExpiry) : inputExpiry
                  );
                  await tx
                    .insert(sourceCleanup)
                    .values({
                      id: `candidate:${candidate.candidateId}`,
                      context,
                      assetId,
                      applicationId: asset.applicationId,
                      target: { kind: 'candidate', candidateId: candidate.candidateId },
                      dueAt: inputDue,
                    })
                    .onConflictDoUpdate({
                      target: sourceCleanup.id,
                      set: {
                        dueAt: sql`least(${sourceCleanup.dueAt}, ${inputDue})`,
                        ...(terminal ? { context } : {}),
                      },
                    });
                  const sourceDue =
                    candidate.status === 'accepted'
                      ? null
                      : new Date(
                          terminal
                            ? Math.min(Date.now(), Date.parse(candidate.orphanExpiresAt))
                            : candidate.orphanExpiresAt
                        );
                  const sourceWork = tx.insert(sourceCleanup).values({
                    id: `source:${candidate.sourceId}`,
                    context,
                    assetId,
                    applicationId: asset.applicationId,
                    target: { kind: 'source', assetId, sourceId: candidate.sourceId },
                    dueAt: sourceDue,
                  });
                  if (
                    changed.state.sources.some((source) => source.sourceId === candidate.sourceId)
                  )
                    await sourceWork.onConflictDoUpdate({
                      target: sourceCleanup.id,
                      set: { dueAt: null, context },
                    });
                  else if (candidate.status === 'accepted') await sourceWork.onConflictDoNothing();
                  else
                    await sourceWork.onConflictDoUpdate({
                      target: sourceCleanup.id,
                      set: {
                        dueAt: sql`least(${sourceCleanup.dueAt}, ${sourceDue})`,
                        ...(terminal ? { context } : {}),
                      },
                    });
                }
                for (const source of changed.state.sources) {
                  const [fence] = await tx
                    .select({ status: sourceCleanup.status })
                    .from(sourceCleanup)
                    .where(eq(sourceCleanup.id, `source:${source.sourceId}`));
                  if (fence && fence.status !== 'pending')
                    throw new Error('Reclaimed Source cannot regain membership');
                  const [existing] = await tx
                    .select()
                    .from(immutableSources)
                    .where(eq(immutableSources.id, source.sourceId));
                  if (
                    existing &&
                    (existing.evidenceExpiresAt !== null ||
                      existing.assetId !== assetId ||
                      !isDeepStrictEqual(existing.facts, source.facts) ||
                      existing.layout !== source.layout)
                  )
                    throw new Error('Immutable Source conflict');
                  if (!existing)
                    await tx.insert(immutableSources).values({
                      id: source.sourceId,
                      assetId,
                      facts: source.facts,
                      layout: source.layout,
                    });
                }
                for (const { sourceId, evidenceExpiresAt } of [
                  ...(changed.retirement ? [changed.retirement] : []),
                  ...(changed.retirements ?? []),
                ]) {
                  if (
                    !priorSources.includes(sourceId) ||
                    changed.state.sources.some((source) => source.sourceId === sourceId)
                  )
                    throw new Error('Invalid Source retirement');
                  const retired = await tx
                    .update(immutableSources)
                    .set({ evidenceExpiresAt: new Date(evidenceExpiresAt) })
                    .where(
                      and(
                        eq(immutableSources.id, sourceId),
                        eq(immutableSources.assetId, assetId),
                        isNull(immutableSources.evidenceExpiresAt)
                      )
                    )
                    .returning({ id: immutableSources.id });
                  if (retired.length !== 1) throw new Error('Source already retired');
                  await tx
                    .insert(sourceCleanup)
                    .values({
                      id: `source:${sourceId}`,
                      context: changed.cleanupContext,
                      assetId,
                      applicationId: asset.applicationId,
                      target: { kind: 'source', assetId, sourceId },
                      dueAt: new Date(evidenceExpiresAt),
                    })
                    .onConflictDoUpdate({
                      target: sourceCleanup.id,
                      set: { dueAt: new Date(evidenceExpiresAt), context: changed.cleanupContext },
                    });
                }
                let sequence = initial?.candidateSequence ?? 0;
                for (const candidate of changed.state.candidates) {
                  const prior = priorValues.get(candidate.candidateId);
                  if (isDeepStrictEqual(prior, candidate)) continue;
                  const values = {
                    candidate,
                    liveUntil: ['accepted', 'rejected', 'cancelled'].includes(candidate.status)
                      ? null
                      : new Date(candidate.expiresAt),
                  };
                  if (prior)
                    await tx
                      .update(sourceCandidates)
                      .set(values)
                      .where(
                        and(
                          eq(sourceCandidates.assetId, assetId),
                          eq(sourceCandidates.id, candidate.candidateId)
                        )
                      );
                  else
                    await tx.insert(sourceCandidates).values({
                      ...values,
                      assetId,
                      id: candidate.candidateId,
                      replayKey: candidate.idempotencyKey,
                      sourceId: candidate.sourceId,
                      position: sequence++,
                    });
                }
                const persisted = { ...changed.state, candidates: [], candidateSequence: sequence };
                delete persisted.candidateWindow;
                delete persisted.liveCandidateCount;
                await tx
                  .insert(assetSourceState)
                  .values({ assetId, state: persisted })
                  .onConflictDoUpdate({
                    target: assetSourceState.assetId,
                    set: { state: persisted },
                  });
              }
              if (changed.confirmation) {
                if (
                  !changed.state ||
                  changed.confirmation.assetId !== assetId ||
                  changed.confirmation.applicationId !== changed.state.asset.applicationId
                )
                  throw new Error('Invalid Source confirmation');
                await tx
                  .insert(sourceAcceptanceOutbox)
                  .values({ id: changed.confirmation.id, confirmation: changed.confirmation })
                  .onConflictDoNothing();
              }
              return changed.result;
            })
          ),
      };
      const match = (p: SourcePublication) =>
        and(
          eq(sourceAcceptanceOutbox.id, p.id),
          eq(sourceAcceptanceOutbox.leaseId, p.leaseId),
          eq(sourceAcceptanceOutbox.status, 'publishing')
        );
      const outbox: SourceAcceptanceOutboxPort = {
        claim: (limit) =>
          run('claim-confirmations', (db) =>
            db.transaction(async (tx) => {
              const now = new Date();
              await tx
                .update(sourceAcceptanceOutbox)
                .set({ status: 'quarantined' })
                .where(
                  and(
                    eq(sourceAcceptanceOutbox.status, 'publishing'),
                    lte(sourceAcceptanceOutbox.availableAt, now),
                    sql`${sourceAcceptanceOutbox.attempts} >= ${options.maxAttempts}`
                  )
                );
              const rows = await tx
                .select()
                .from(sourceAcceptanceOutbox)
                .where(
                  and(
                    inArray(sourceAcceptanceOutbox.status, ['pending', 'publishing']),
                    lte(sourceAcceptanceOutbox.availableAt, now),
                    sql`${sourceAcceptanceOutbox.attempts} < ${options.maxAttempts}`
                  )
                )
                .orderBy(asc(sourceAcceptanceOutbox.occurredAt))
                .limit(Math.max(1, Math.min(100, limit)))
                .for('update', { skipLocked: true });
              const result: SourcePublication[] = [];
              for (const row of rows) {
                const leaseId = randomUUID();
                await tx
                  .update(sourceAcceptanceOutbox)
                  .set({
                    status: 'publishing',
                    leaseId,
                    attempts: row.attempts + 1,
                    availableAt: new Date(Date.now() + options.leaseMs),
                  })
                  .where(eq(sourceAcceptanceOutbox.id, row.id));
                result.push({
                  id: row.id,
                  confirmation: row.confirmation,
                  leaseId,
                  attempts: row.attempts + 1,
                  occurredAt: row.occurredAt.toISOString(),
                });
              }
              return result;
            })
          ),
        published: (p) =>
          run('confirm-publication', async (db) => {
            await db
              .update(sourceAcceptanceOutbox)
              .set({ status: 'published', leaseId: null })
              .where(match(p));
          }),
        failed: (p) =>
          run('fail-publication', async (db) => {
            await db
              .update(sourceAcceptanceOutbox)
              .set({
                status: p.attempts >= options.maxAttempts ? 'quarantined' : 'pending',
                leaseId: null,
                availableAt: new Date(
                  Date.now() + Math.min(30000, options.retryDelayMs * 2 ** (p.attempts - 1))
                ),
              })
              .where(match(p));
          }),
        pendingAlerts: () =>
          run('pending-alerts', async (db) =>
            (
              await db
                .select()
                .from(sourceAcceptanceOutbox)
                .where(
                  and(
                    eq(sourceAcceptanceOutbox.status, 'quarantined'),
                    isNull(sourceAcceptanceOutbox.notifiedAt)
                  )
                )
                .limit(100)
            ).map((row) => ({ ...row.confirmation, quarantineId: row.quarantineId }))
          ),
        alerted: (alert) =>
          run('confirm-alert', async (db) => {
            await db
              .update(sourceAcceptanceOutbox)
              .set({ notifiedAt: new Date() })
              .where(
                and(
                  eq(sourceAcceptanceOutbox.id, alert.id),
                  eq(sourceAcceptanceOutbox.quarantineId, alert.quarantineId),
                  eq(sourceAcceptanceOutbox.status, 'quarantined')
                )
              );
          }),
        recover: (id) =>
          Effect.gen(function* () {
            const confirmation = yield* run('inspect-recovery', async (db) => {
              const [row] = await db
                .select()
                .from(sourceAcceptanceOutbox)
                .where(eq(sourceAcceptanceOutbox.id, id));
              return row?.confirmation;
            });
            if (!confirmation) return false;
            const recovered = yield* observeWorkflow(
              'asset.sources.recover-confirmation',
              confirmation.context,
              {
                'event.id': id,
                'event.source': 'https://wallpaperdb/asset',
                'event.type': 'asset.source.accepted',
                'event.causation_id': confirmation.context.occurrence.id,
                'asset.id': confirmation.assetId,
                'candidate.id': confirmation.candidateId,
                'application.id': confirmation.applicationId,
                ...(confirmation.context.correlationId
                  ? { 'event.correlation_id': confirmation.context.correlationId }
                  : {}),
              },
              run('recover', async (db) => {
                const rows = await db
                  .update(sourceAcceptanceOutbox)
                  .set({
                    status: 'pending',
                    attempts: 0,
                    availableAt: new Date(),
                    leaseId: null,
                    notifiedAt: null,
                    quarantineId: randomUUID(),
                  })
                  .where(
                    and(
                      eq(sourceAcceptanceOutbox.id, id),
                      eq(sourceAcceptanceOutbox.status, 'quarantined')
                    )
                  )
                  .returning({ id: sourceAcceptanceOutbox.id });
                return rows.length === 1 ? 'recovered' : 'unavailable';
              })
            );
            return recovered === 'recovered';
          }),
      };
      return Context.make(SourceStore, store).pipe(Context.add(SourceAcceptanceOutbox, outbox));
    })
  );
}
