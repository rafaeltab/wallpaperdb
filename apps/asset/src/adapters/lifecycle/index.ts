import { createHash, randomUUID } from 'node:crypto';
import { AssetCommandResultSchema } from '@wallpaperdb/events/schemas';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
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
    if (!released) client.release();
  }
}
const poolResource = (databaseUrl: string) =>
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new Pool({
          connectionString: databaseUrl,
          max: 4,
          connectionTimeoutMillis: 5000,
          statement_timeout: 10000,
        })
    ),
    (pool) => Effect.promise(() => pool.end())
  );
function result(input: unknown): CommandResult {
  const parsed = AssetCommandResultSchema.parse(input);
  if (parsed.outcome !== 'created' && parsed.outcome !== 'rejected')
    throw new Error('Unexpected lifecycle result');
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
    await tx
      .insert(assetResultOutbox)
      .values({
        id: digest,
        applicationId: input.applicationId,
        commandId: input.correlation.commandId,
        payloadDigest: digest,
        result: outcome,
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
            const [row] = await db.select().from(ownedAssets).where(eq(ownedAssets.id, id));
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
