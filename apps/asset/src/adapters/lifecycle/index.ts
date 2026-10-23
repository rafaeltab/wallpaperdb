import { createHash, randomUUID } from 'node:crypto';
import { AssetCommandResultSchema } from '@wallpaperdb/events/schemas';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { and, asc, eq, inArray, lte, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import {
  LifecycleFailure,
  LifecycleStore,
  ResultOutbox,
  type Acceptance,
  type CommandResult,
  type LifecycleStorePort,
  type ResultOutboxPort,
  type ResultPublication,
} from '../../capabilities/lifecycle/index.js';
import {
  assetCommands,
  assetConfiguration,
  assetResultOutbox,
  ownedAssets,
  assetSourceState,
  immutableSources,
  assetDeletions,
  sourceCleanup,
} from '../../db/schema.js';

interface PostgresOptions {
  readonly databaseUrl: string;
  readonly revision: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
}
function operation<A>(name: string, run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new LifecycleFailure({ operation: name, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Asset lifecycle persistence failed', { operation: name, cause: error.cause })
    ),
    Effect.withSpan(`asset.lifecycle.database.${name}`)
  );
}
async function connection<A>(
  pool: Pool,
  signal: AbortSignal,
  run: (db: ReturnType<typeof drizzle>) => Promise<A>
): Promise<A> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const client = await pool.connect();
  let released = false;
  let failed = false;
  // pg rejects outstanding queries and also emits on the checked-out client.
  // Keep that event owned until release; the operation records the typed failure.
  const connectionError = () => {
    failed = true;
  };
  client.on('error', connectionError);
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
      throw new Error('Lifecycle operation cancelled');
    }
    return await run(drizzle(client));
  } finally {
    deadline.removeEventListener('abort', abort);
    client.off('error', connectionError);
    if (!released) client.release(failed);
  }
}
const poolResource = (databaseUrl: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const pool = new Pool({
        connectionString: databaseUrl,
        max: 4,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      });
      pool.on('error', (cause) =>
        logs.getLogger('asset.lifecycle').emit({
          severityNumber: SeverityNumber.ERROR,
          body: 'Idle Asset database connection failed',
          attributes: { 'error.type': cause.name, 'error.message': cause.message },
        })
      );
      return pool;
    }),
    (pool) => Effect.promise(() => pool.end())
  );
function result(input: unknown): CommandResult {
  const parsed = AssetCommandResultSchema.parse(input);
  return parsed;
}
async function accept(db: ReturnType<typeof drizzle>, input: Acceptance) {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(assetConfiguration)
      .where(eq(assetConfiguration.id, 1))
      .for('share');
    if (active?.revision !== input.revision) throw new Error('Inactive Asset configuration');
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.applicationId, input.correlation.commandId])}, 0))`
    );
    const [recorded] = await tx
      .select()
      .from(assetCommands)
      .where(
        and(
          eq(assetCommands.applicationId, input.applicationId),
          eq(assetCommands.commandId, input.correlation.commandId)
        )
      );
    let outcome: CommandResult;
    if (recorded)
      outcome =
        recorded.canonical === input.canonical
          ? result(recorded.result)
          : {
              ...input.correlation,
              outcome: 'rejected',
              assetId: null,
              reason: 'idempotency-conflict',
            };
    else {
      if (input.decision.kind === 'create') {
        const id = `asset_${randomUUID()}`;
        await tx.insert(ownedAssets).values({
          id,
          applicationId: input.applicationId,
          assetType: input.decision.assetType,
          ownerNamespace: input.decision.owner.namespace,
          ownerSubject: input.decision.owner.subject,
        });
        outcome = { ...input.correlation, outcome: 'created', assetId: id };
      } else if (input.decision.kind === 'delete') {
        const decision = input.decision;
        const [asset] = await tx
          .select()
          .from(ownedAssets)
          .where(eq(ownedAssets.id, decision.assetId))
          .for('update');
        if (!asset || asset.applicationId !== input.applicationId)
          outcome = {
            ...input.correlation,
            outcome: 'rejected',
            assetId: null,
            reason: 'unavailable-asset',
          };
        else if (asset.deletedAt !== null)
          outcome = { ...input.correlation, outcome: 'already-deleted', assetId: asset.id };
        else {
          const retentionMs = decision.evidenceRetentionMsByType[asset.assetType];
          if (!Number.isSafeInteger(retentionMs) || retentionMs === undefined || retentionMs < 0)
            throw new Error('Missing Asset deletion retention policy');
          const deletedAt = new Date();
          const evidenceExpiresAt = new Date(deletedAt.getTime() + retentionMs);
          const [record] = await tx
            .select()
            .from(assetSourceState)
            .where(eq(assetSourceState.assetId, asset.id));
          const sourceSetRevision = (
            BigInt(record?.state.sourceSetRevision ?? '0') + 1n
          ).toString();
          const deliveryRevision = (BigInt(record?.state.deliveryRevision ?? '0') + 1n).toString();
          await tx.update(ownedAssets).set({ deletedAt }).where(eq(ownedAssets.id, asset.id));
          if (record) {
            const state = record.state;
            state.sources = [];
            state.defaultSourceId = null;
            state.sourceSetRevision = sourceSetRevision;
            state.deliveryRevision = deliveryRevision;
            for (const candidate of state.candidates)
              if (!['accepted', 'rejected', 'cancelled'].includes(candidate.status)) {
                candidate.status = 'cancelled';
                candidate.reason = 'asset-deleted';
              }
            for (const candidate of state.candidates) {
              await tx
                .insert(sourceCleanup)
                .values({
                  id: `candidate:${candidate.candidateId}`,
                  assetId: asset.id,
                  applicationId: asset.applicationId,
                  target: { kind: 'candidate', candidateId: candidate.candidateId },
                  dueAt: new Date(
                    Math.min(
                      deletedAt.getTime(),
                      Date.parse(candidate.temporaryExpiresAt ?? candidate.expiresAt)
                    )
                  ),
                })
                .onConflictDoUpdate({
                  target: sourceCleanup.id,
                  set: { dueAt: sql`least(${sourceCleanup.dueAt}, ${deletedAt})` },
                });
              if (candidate.status !== 'accepted')
                await tx
                  .insert(sourceCleanup)
                  .values({
                    id: `source:${candidate.sourceId}`,
                    assetId: asset.id,
                    applicationId: asset.applicationId,
                    target: { kind: 'source', assetId: asset.id, sourceId: candidate.sourceId },
                    dueAt: new Date(
                      Math.min(deletedAt.getTime(), Date.parse(candidate.orphanExpiresAt))
                    ),
                  })
                  .onConflictDoUpdate({
                    target: sourceCleanup.id,
                    set: { dueAt: sql`least(${sourceCleanup.dueAt}, ${deletedAt})` },
                  });
            }
            state.nonterminalCandidateCount = 0;
            await tx
              .update(assetSourceState)
              .set({ state })
              .where(eq(assetSourceState.assetId, asset.id));
          }
          const retiredSources = await tx
            .update(immutableSources)
            .set({ evidenceExpiresAt })
            .where(
              and(
                eq(immutableSources.assetId, asset.id),
                isNull(immutableSources.evidenceExpiresAt)
              )
            )
            .returning({ id: immutableSources.id });
          for (const source of retiredSources)
            await tx
              .insert(sourceCleanup)
              .values({
                id: `source:${source.id}`,
                assetId: asset.id,
                applicationId: asset.applicationId,
                target: { kind: 'source', assetId: asset.id, sourceId: source.id },
                dueAt: evidenceExpiresAt,
              })
              .onConflictDoUpdate({ target: sourceCleanup.id, set: { dueAt: evidenceExpiresAt } });
          await tx.insert(assetDeletions).values({
            assetId: asset.id,
            deletedAt,
            sourceSetRevision,
            deliveryRevision,
            evidenceExpiresAt,
          });
          outcome = { ...input.correlation, outcome: 'deleted', assetId: asset.id };
        }
      } else
        outcome = {
          ...input.correlation,
          outcome: 'rejected',
          assetId: null,
          reason: input.decision.reason,
        };
      await tx.insert(assetCommands).values({
        applicationId: input.applicationId,
        commandId: input.correlation.commandId,
        canonical: input.canonical,
        result: outcome,
      });
    }
    const digest = createHash('sha256')
      .update(JSON.stringify([input.applicationId, input.correlation.commandId, input.canonical]))
      .digest('hex');
    const publicationId = createHash('sha256')
      .update(
        JSON.stringify([digest, input.context.occurrence.source, input.context.occurrence.id])
      )
      .digest('hex');
    await tx
      .insert(assetResultOutbox)
      .values({
        id: publicationId,
        applicationId: input.applicationId,
        commandId: input.correlation.commandId,
        payloadDigest: digest,
        result: outcome,
        context: input.context,
      })
      .onConflictDoNothing();
    return outcome;
  });
}
/** Explicit operator activation fences every prior revision under the same row lock used by acceptance. */
export function activateLifecycle(databaseUrl: string, revision: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* poolResource(databaseUrl);
      yield* operation('activate', (signal) =>
        connection(pool, signal, (db) =>
          db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(466)`);
            await tx
              .insert(assetConfiguration)
              .values({ id: 1, revision })
              .onConflictDoUpdate({ target: assetConfiguration.id, set: { revision } });
          })
        )
      );
    })
  );
}
/** Development bootstrap never replaces an already active configuration. */
export function initializeLifecycle(databaseUrl: string, revision: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* poolResource(databaseUrl);
      yield* operation('initialize-configuration', (signal) =>
        connection(pool, signal, (db) =>
          db.transaction(async (tx) => {
            await tx.insert(assetConfiguration).values({ id: 1, revision }).onConflictDoNothing();
            const [active] = await tx
              .select()
              .from(assetConfiguration)
              .where(eq(assetConfiguration.id, 1))
              .for('share');
            if (active?.revision !== revision)
              throw new Error('Explicitly activate the new Asset configuration before startup');
          })
        )
      );
    })
  );
}
export function lifecyclePostgresLayer(options: PostgresOptions) {
  return Layer.effectContext(
    Effect.gen(function* () {
      const pool = yield* poolResource(options.databaseUrl);
      const run = <A>(name: string, fn: (db: ReturnType<typeof drizzle>) => Promise<A>) =>
        operation(name, (signal) => connection(pool, signal, fn));
      yield* run('verify-configuration', async (db) => {
        const [active] = await db
          .select()
          .from(assetConfiguration)
          .where(eq(assetConfiguration.id, 1));
        if (active?.revision !== options.revision)
          throw new Error('Activate the selected Asset configuration before startup');
      });
      const store: LifecycleStorePort = {
        accept: (input) => run('accept-command', (db) => accept(db, input)),
        find: (id) =>
          run('inspect-owner', async (db) => {
            const [row] = await db
              .select()
              .from(ownedAssets)
              .where(and(eq(ownedAssets.id, id), isNull(ownedAssets.deletedAt)));
            return row
              ? {
                  id: row.id,
                  applicationId: row.applicationId,
                  assetType: row.assetType,
                  owner: { namespace: row.ownerNamespace, subject: row.ownerSubject },
                }
              : null;
          }),
      };
      const leaseMatch = (publication: ResultPublication) =>
        and(
          eq(assetResultOutbox.id, publication.id),
          eq(assetResultOutbox.leaseId, publication.leaseId),
          eq(assetResultOutbox.status, 'publishing')
        );
      const outbox: ResultOutboxPort = {
        pendingAlerts: (limit) =>
          run('pending-result-alerts', (db) =>
            db
              .select({
                id: assetResultOutbox.id,
                applicationId: assetResultOutbox.applicationId,
                context: assetResultOutbox.context,
              })
              .from(assetResultOutbox)
              .where(
                and(
                  eq(assetResultOutbox.status, 'quarantined'),
                  isNull(assetResultOutbox.notifiedAt)
                )
              )
              .limit(Math.max(1, Math.min(limit, 100)))
          ),
        alerted: (id) =>
          run('confirm-result-alert', async (db) => {
            await db
              .update(assetResultOutbox)
              .set({ notifiedAt: new Date() })
              .where(eq(assetResultOutbox.id, id));
          }),
        recover: (id) =>
          run('recover-result', async (db) => {
            const rows = await db
              .update(assetResultOutbox)
              .set({
                status: 'pending',
                attempts: 0,
                availableAt: new Date(),
                leaseId: null,
                notifiedAt: null,
              })
              .where(and(eq(assetResultOutbox.id, id), eq(assetResultOutbox.status, 'quarantined')))
              .returning({ id: assetResultOutbox.id });
            return rows.length === 1;
          }),
        claim: (limit) =>
          run('claim-results', (db) =>
            db.transaction(async (tx) => {
              const now = new Date();
              // Crashed publication attempts count toward the finite budget too.
              await tx
                .update(assetResultOutbox)
                .set({ status: 'quarantined' })
                .where(
                  and(
                    eq(assetResultOutbox.status, 'publishing'),
                    lte(assetResultOutbox.availableAt, now),
                    sql`${assetResultOutbox.attempts} >= ${options.maxAttempts}`
                  )
                );
              const rows = await tx
                .select()
                .from(assetResultOutbox)
                .where(
                  and(
                    inArray(assetResultOutbox.status, ['pending', 'publishing']),
                    lte(assetResultOutbox.availableAt, now),
                    sql`${assetResultOutbox.attempts} < ${options.maxAttempts}`
                  )
                )
                .orderBy(asc(assetResultOutbox.occurredAt))
                .limit(Math.max(1, Math.min(limit, 100)))
                .for('update', { skipLocked: true });
              const claimed: ResultPublication[] = [];
              for (const row of rows) {
                const leaseId = randomUUID();
                await tx
                  .update(assetResultOutbox)
                  .set({
                    status: 'publishing',
                    leaseId,
                    attempts: row.attempts + 1,
                    availableAt: new Date(now.getTime() + options.leaseMs),
                  })
                  .where(eq(assetResultOutbox.id, row.id));
                claimed.push({
                  id: row.id,
                  context: row.context,
                  leaseId,
                  applicationId: row.applicationId,
                  result: result(row.result),
                  occurredAt: row.occurredAt.toISOString(),
                  attempts: row.attempts + 1,
                });
              }
              return claimed;
            })
          ),
        published: (publication) =>
          run('confirm-result', async (db) => {
            await db
              .update(assetResultOutbox)
              .set({ status: 'published', leaseId: null })
              .where(leaseMatch(publication));
          }),
        failed: (publication) =>
          run('fail-result', async (db) => {
            await db
              .update(assetResultOutbox)
              .set({
                status: publication.attempts >= options.maxAttempts ? 'quarantined' : 'pending',
                leaseId: null,
                availableAt: new Date(
                  Date.now() +
                    Math.min(30000, options.retryDelayMs * 2 ** (publication.attempts - 1))
                ),
              })
              .where(leaseMatch(publication));
          }),
      };
      return Context.make(LifecycleStore, store).pipe(Context.add(ResultOutbox, outbox));
    })
  );
}
