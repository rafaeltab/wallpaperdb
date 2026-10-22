import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer } from 'effect';
import { Pool } from 'pg';
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
} from '../../db/schema.js';
interface Options {
  readonly databaseUrl: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
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
          pool.on('error', () => {});
          return pool;
        }),
        (pool) => Effect.promise(() => pool.end())
      );
      const run = <A>(operation: string, work: (db: ReturnType<typeof drizzle>) => Promise<A>) =>
        Effect.tryPromise({
          try: async (signal) => {
            const client = await pool.connect();
            let released = false;
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
              return await work(drizzle(client));
            } finally {
              deadline.removeEventListener('abort', abort);
              if (!released) client.release();
            }
          },
          catch: (cause) => new SourceFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Source persistence failed', { operation, cause: error.cause })
          ),
          Effect.withSpan(`asset.sources.database.${operation}`)
        );
      const store: SourceStorePort = {
        transact: (assetId, revision, change) =>
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
              const initial: SourceState | null = asset
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
                  })
                : null;
              const changed = change(initial);
              if (changed.state && asset) {
                for (const source of changed.state.sources) {
                  const [existing] = await tx
                    .select()
                    .from(immutableSources)
                    .where(eq(immutableSources.id, source.sourceId));
                  if (
                    existing &&
                    (existing.assetId !== assetId ||
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
                await tx
                  .insert(assetSourceState)
                  .values({ assetId, state: changed.state })
                  .onConflictDoUpdate({
                    target: assetSourceState.assetId,
                    set: { state: changed.state },
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
            ).map((row) => row.confirmation)
          ),
        alerted: (id) =>
          run('confirm-alert', async (db) => {
            await db
              .update(sourceAcceptanceOutbox)
              .set({ notifiedAt: new Date() })
              .where(eq(sourceAcceptanceOutbox.id, id));
          }),
        recover: (id) =>
          run('recover', async (db) => {
            const rows = await db
              .update(sourceAcceptanceOutbox)
              .set({
                status: 'pending',
                attempts: 0,
                availableAt: new Date(),
                leaseId: null,
                notifiedAt: null,
              })
              .where(
                and(
                  eq(sourceAcceptanceOutbox.id, id),
                  eq(sourceAcceptanceOutbox.status, 'quarantined')
                )
              )
              .returning({ id: sourceAcceptanceOutbox.id });
            return rows.length === 1;
          }),
      };
      return Context.make(SourceStore, store).pipe(Context.add(SourceAcceptanceOutbox, outbox));
    })
  );
}
