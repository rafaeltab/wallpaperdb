import { randomUUID, createHash } from 'node:crypto';
import { Context, Effect, Layer } from 'effect';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  WorkflowStore,
  WorkflowDelivery,
  WorkflowFailure,
  type Wallpaper,
  type WorkflowStorePort,
  type WorkflowDeliveryPort,
  type WorkflowPublication,
} from '../../capabilities/creation/index.js';
import { wallpaperIntents, workflowOutbox, workflowQuarantine } from '../../db/schema.js';
interface Options {
  readonly databaseUrl: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
}
export function workflowPostgresLayer(options: Options) {
  return Layer.effectContext(
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const p = new Pool({
            connectionString: options.databaseUrl,
            max: 10,
            connectionTimeoutMillis: 2000,
            statement_timeout: 5000,
            idle_in_transaction_session_timeout: 5000,
          });
          p.on('error', (cause) => {
            void Effect.runPromise(
              Effect.logError('Wallpaper idle database connection failed', { cause })
            );
          });
          return p;
        }),
        (p) => Effect.promise(() => p.end())
      );
      const db = drizzle(pool);
      const query = <A>(operation: string, run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new WorkflowFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Wallpaper persistence unavailable', { operation, cause: error.cause })
          ),
          Effect.withSpan(`wallpaper.persistence.${operation}`)
        );
      const store: WorkflowStorePort = {
        list: (owner) =>
          query('list', async () => {
            const rows = await db
              .select({ state: wallpaperIntents.state })
              .from(wallpaperIntents)
              .where(
                and(
                  eq(wallpaperIntents.ownerNamespace, owner.namespace),
                  eq(wallpaperIntents.contributorId, owner.subject)
                )
              )
              .orderBy(sql`${wallpaperIntents.state}->>'createdAt' desc`)
              .limit(100);
            return rows.map((row) => row.state);
          }),
        begin: (owner, key) =>
          query('begin', () =>
            db.transaction(async (tx) => {
              const id = `wlp_${randomUUID()}`;
              const creationEventId = randomUUID();
              const createdAt = new Date().toISOString();
              const wallpaper: Wallpaper = {
                id,
                owner,
                key,
                commandId: randomUUID(),
                creationEventId,
                createdAt,
                state: 'creating-asset',
                assetId: null,
                intent: null,
                sourceId: null,
                initialAnalysisSourceId: null,
              };
              const inserted = await tx
                .insert(wallpaperIntents)
                .values({
                  id,
                  ownerNamespace: owner.namespace,
                  contributorId: owner.subject,
                  key,
                  state: wallpaper,
                })
                .onConflictDoNothing()
                .returning();
              if (inserted.length) {
                await tx.insert(workflowOutbox).values({
                  id: creationEventId,
                  wallpaperId: id,
                  destination: 'asset-create',
                  event: {
                    specversion: '1.0',
                    id: creationEventId,
                    source: 'https://wallpaperdb/wallpaper',
                    type: 'asset.command.create',
                    time: createdAt,
                    datacontenttype: 'application/json',
                    correlationid: id,
                    data: {
                      commandId: wallpaper.commandId,
                      applicationReference: id,
                      assetType: 'wallpaper',
                      ownerSubject: owner.subject,
                    },
                  },
                });
                return wallpaper;
              }
              const rows = await tx
                .select()
                .from(wallpaperIntents)
                .where(
                  and(
                    eq(wallpaperIntents.ownerNamespace, owner.namespace),
                    eq(wallpaperIntents.contributorId, owner.subject),
                    eq(wallpaperIntents.key, key)
                  )
                );
              if (!rows[0]) throw new Error('Creation identity reservation missing');
              return rows[0].state;
            })
          ),
        change: (selector, transition) =>
          query('transition', () =>
            db.transaction(async (tx) => {
              const rows = await tx
                .select()
                .from(wallpaperIntents)
                .where(
                  selector.kind === 'wallpaper'
                    ? eq(wallpaperIntents.id, selector.id)
                    : eq(wallpaperIntents.assetId, selector.id)
                )
                .for('update');
              const current = rows[0]?.state ?? null;
              const changed = transition(current ? structuredClone(current) : null);
              if (changed.wallpaper) {
                await tx
                  .update(wallpaperIntents)
                  .set({ state: changed.wallpaper, assetId: changed.wallpaper.assetId })
                  .where(eq(wallpaperIntents.id, changed.wallpaper.id));
                if (changed.publication) {
                  const { id, ...data } = changed.publication;
                  await tx
                    .insert(workflowOutbox)
                    .values({
                      id,
                      wallpaperId: changed.wallpaper.id,
                      destination: 'publication',
                      event: {
                        specversion: '1.0',
                        id,
                        source: 'https://wallpaperdb/wallpaper',
                        type: 'wallpaper.published',
                        time: new Date().toISOString(),
                        datacontenttype: 'application/json',
                        correlationid: changed.wallpaper.id,
                        causationid: data.causationId,
                        causationsource: 'https://wallpaperdb/asset',
                        data: {
                          wallpaperId: data.wallpaperId,
                          contributorId: data.contributorId,
                          assetId: data.assetId,
                          firstSourceId: data.sourceId,
                          initialAnalysisSourceId: data.initialAnalysisSourceId,
                        },
                      },
                    })
                    .onConflictDoNothing();
                }
              }
              return changed.result;
            })
          ),
      };
      const delivery: WorkflowDeliveryPort = {
        claim: () =>
          query('claim', () =>
            db.transaction(async (tx) => {
              const now = new Date();
              const rows = await tx
                .select()
                .from(workflowOutbox)
                .where(
                  and(
                    or(eq(workflowOutbox.status, 'pending'), eq(workflowOutbox.status, 'leased')),
                    lte(workflowOutbox.availableAt, now)
                  )
                )
                .limit(10)
                .for('update', { skipLocked: true });
              const publications: WorkflowPublication[] = [];
              for (const row of rows) {
                const leaseId = randomUUID();
                await tx
                  .update(workflowOutbox)
                  .set({
                    status: 'leased',
                    leaseId,
                    availableAt: new Date(Date.now() + options.leaseMs),
                  })
                  .where(eq(workflowOutbox.id, row.id));
                publications.push({
                  id: row.id,
                  wallpaperId: row.wallpaperId,
                  destination: row.destination,
                  event: row.event,
                  leaseId,
                  attempts: row.attempts,
                });
              }
              return publications;
            })
          ),
        complete: (p) =>
          query('complete', async () => {
            await db
              .update(workflowOutbox)
              .set({ status: 'published', leaseId: null })
              .where(and(eq(workflowOutbox.id, p.id), eq(workflowOutbox.leaseId, p.leaseId)));
          }),
        failed: (p) =>
          query('failed', () =>
            db.transaction(async (tx) => {
              const exhausted = p.attempts + 1 >= options.maxAttempts;
              const changed = await tx
                .update(workflowOutbox)
                .set({
                  status: exhausted ? 'quarantined' : 'pending',
                  attempts: p.attempts + 1,
                  leaseId: null,
                  availableAt: new Date(Date.now() + options.retryDelayMs),
                })
                .where(and(eq(workflowOutbox.id, p.id), eq(workflowOutbox.leaseId, p.leaseId)))
                .returning();
              if (exhausted && changed.length && p.destination === 'asset-create') {
                const rows = await tx
                  .select()
                  .from(wallpaperIntents)
                  .where(eq(wallpaperIntents.id, p.wallpaperId))
                  .for('update');
                const w = rows[0]?.state;
                // A timeout may have stored the command. Keep the creation intent alive so a
                // late, matching confirmation can still complete it after deliberate recovery.
                if (w)
                  await tx
                    .insert(workflowQuarantine)
                    .values({
                      id: `outbox:${p.id}`,
                      payload: JSON.stringify(p.event),
                      reason: 'publication-exhausted',
                    })
                    .onConflictDoNothing();
              }
            })
          ),
        quarantine: (id, payload, reason) =>
          query('quarantine', async () => {
            await db
              .insert(workflowQuarantine)
              .values({
                id: createHash('sha256').update(id).digest('hex'),
                payload: payload.slice(0, 16384),
                reason,
              })
              .onConflictDoNothing();
          }),
        recover: (id) =>
          query('recover', async () => {
            const rows = await db
              .update(workflowOutbox)
              .set({ status: 'pending', attempts: 0, availableAt: new Date(), leaseId: null })
              .where(and(eq(workflowOutbox.id, id), eq(workflowOutbox.status, 'quarantined')))
              .returning({ id: workflowOutbox.id });
            return rows.length === 1;
          }),
      };
      return Context.make(WorkflowStore, store).pipe(Context.add(WorkflowDelivery, delivery));
    })
  );
}
