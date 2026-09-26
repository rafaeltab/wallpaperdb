import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer, Schema } from 'effect';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import * as schema from '../../db/schema.js';

type Client = NodePgDatabase<typeof schema>;
export interface Database {
  /** A leased connection belongs to this operation until completion. Aborting
   * destroys it, rolling back an open transaction. COMMIT may be ambiguous. */
  run<A>(operation: (db: Client) => Promise<A>, signal: AbortSignal): Promise<A>;
  readonly check: Effect.Effect<boolean>;
}
export const Database = Context.Service<Database>('wallpaperdb.user.adapters.Database');
export class DatabaseUnavailable extends Schema.TaggedError<DatabaseUnavailable>()(
  'DatabaseUnavailable',
  { cause: Schema.Defect() }
) {}

const driverDiagnostic = z.object({ code: z.string().regex(/^[A-Z0-9]{5}$/) });
const causalError = z.object({ cause: z.unknown() });

/** Vendor exception messages, details and SQL parameters can contain private data. */
export function databaseDiagnostic(cause: unknown): { sqlState?: string } {
  const visited = new Set<unknown>();
  let current = cause;
  while (!visited.has(current)) {
    visited.add(current);
    const driver = driverDiagnostic.safeParse(current);
    if (driver.success) return { sqlState: driver.data.code };
    const wrapped = causalError.safeParse(current);
    if (!wrapped.success) return {};
    current = wrapped.data.cause;
  }
  return {};
}

async function withConnection<A>(
  pool: Pool,
  cancellationPool: Pool,
  operation: (db: Client) => Promise<A>,
  signal: AbortSignal
): Promise<A> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  deadline.throwIfAborted();
  const client: PoolClient = await pool.connect();
  let released = false;
  let backendPid: number | undefined;
  let cancelled: Promise<unknown> | undefined;
  const abort = () => {
    if (!released) {
      released = true;
      // Closing a TCP socket alone does not interrupt a server-side query such
      // as pg_sleep. Use a separate bounded connection to stop the backend.
      if (backendPid !== undefined)
        cancelled = cancellationPool
          .query('select pg_terminate_backend($1)', [backendPid])
          .catch(() => undefined);
      client.release(true);
    }
  };
  deadline.addEventListener('abort', abort, { once: true });
  try {
    if (deadline.aborted) {
      abort();
      deadline.throwIfAborted();
    }
    const backend = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
    backendPid = backend.rows[0]?.pid;
    deadline.throwIfAborted();
    return await operation(drizzle(client, { schema }));
  } finally {
    await cancelled;
    deadline.removeEventListener('abort', abort);
    if (!released) {
      released = true;
      client.release();
    }
  }
}

export const databaseLayer = (config: { readonly databaseUrl: string }) =>
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const cancellationPool = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Pool({
              connectionString: config.databaseUrl,
              max: 2,
              connectionTimeoutMillis: 2_000,
              query_timeout: 2_000,
              statement_timeout: 2_000,
              application_name: 'wallpaperdb-user-cancellation',
            })
        ),
        (pool) => Effect.promise(() => pool.end())
      );
      cancellationPool.on('error', () => {});
      const pool = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Pool({
              connectionString: config.databaseUrl,
              connectionTimeoutMillis: 5_000,
              idleTimeoutMillis: 10_000,
              statement_timeout: 15_000,
              max: 10,
              application_name: 'wallpaperdb-user',
            })
        ),
        (pool) => Effect.promise(() => pool.end())
      );
      // Idle socket errors must not crash the process; each operation reports its
      // own technical failure and the health probe detects unavailability.
      pool.on('error', () => {});
      const run = <A>(operation: (db: Client) => Promise<A>, signal: AbortSignal) =>
        withConnection(pool, cancellationPool, operation, signal);
      const check = Effect.tryPromise({
        try: (signal) =>
          run(async (db) => {
            await db.execute('select 1');
          }, signal),
        catch: (cause) => new DatabaseUnavailable({ cause }),
      }).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
      yield* Effect.tryPromise({
        try: (signal) =>
          run(async (db) => {
            await db.execute('select 1');
          }, signal),
        catch: (cause) => new DatabaseUnavailable({ cause }),
      });
      return Database.of({ run, check });
    })
  );
