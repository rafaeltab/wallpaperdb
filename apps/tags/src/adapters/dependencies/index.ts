import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { Effect, Layer, Schema } from 'effect';
import { connect } from 'nats';
import { Pool, type PoolClient } from 'pg';
import { AvailabilityProbe } from '../../availability/index.js';

export interface DependencyProbeConfig {
  readonly databaseUrl: string;
  readonly natsUrl: string;
  readonly serviceName: string;
  readonly otelHealthy: boolean;
}

export class DependencyStartupFailure extends Schema.TaggedError<DependencyStartupFailure>()(
  'DependencyStartupFailure',
  { cause: Schema.Defect() }
) {}

/** PostgreSQL remains lazy; NATS must connect before the service accepts work. */
export function dependencyProbeLayer(config: DependencyProbeConfig) {
  return Layer.effect(
    AvailabilityProbe,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new Pool({
            connectionString: config.databaseUrl,
            max: 1,
            connectionTimeoutMillis: 2000,
            statement_timeout: 5000,
            query_timeout: 5000,
          });
          pool.on('error', (cause) =>
            logs.getLogger('tags.dependencies').emit({
              severityNumber: SeverityNumber.ERROR,
              body: 'Idle database connection failed',
              attributes: { 'error.type': cause.name, 'error.message': cause.message },
            })
          );
          return pool;
        }),
        (pool) => Effect.promise(() => pool.end())
      );
      const nats = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => connect({ servers: config.natsUrl, name: config.serviceName, timeout: 2000 }),
          catch: (cause) => new DependencyStartupFailure({ cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('NATS connection failed', { cause: error.cause })
          )
        ),
        (connection) => Effect.promise(() => connection.close())
      );
      const probe: AvailabilityProbe = {
        inspect: Effect.fn('dependencies.inspect')(function* () {
          const database = yield* Effect.tryPromise({
            try: (signal) => checkDatabase(pool, signal),
            catch: (cause) => cause,
          }).pipe(
            Effect.catch((cause) =>
              Effect.logError('Database health check failed', { cause }).pipe(Effect.as(false))
            )
          );
          return {
            database,
            nats: nats.info !== null && !nats.isClosed(),
            otel: config.otelHealthy,
          };
        }),
      };
      return probe;
    })
  );
}

async function checkDatabase(pool: Pool, signal: AbortSignal): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  let released = false;
  const cancel = () => {
    if (released) return;
    released = true;
    client.release(true);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      return false;
    }
    await client.query('SELECT 1');
    return true;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!released) client.release();
  }
}
