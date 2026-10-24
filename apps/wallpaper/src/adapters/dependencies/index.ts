import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { Effect, Layer, Schema } from 'effect';
import { connect } from 'nats';
import { Pool, type PoolClient } from 'pg';
import { AvailabilityProbe } from '../../capabilities/availability/index.js';

export interface DependencyProbeConfig {
  readonly databaseUrl: string;
  readonly natsUrl: string;
  readonly serviceName: string;
  readonly otelHealthy: boolean;
  readonly healthTimeoutMs?: number;
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
            application_name: config.serviceName,
            max: 1,
            connectionTimeoutMillis: 2000,
            statement_timeout: 5000,
          });
          pool.on('error', (cause) =>
            logs.getLogger('wallpaper.dependencies').emit({
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
          try: () => {
            const url = new URL(config.natsUrl);
            const credentials =
              url.username || url.password
                ? {
                    user: decodeURIComponent(url.username),
                    pass: decodeURIComponent(url.password),
                  }
                : {};
            url.username = '';
            url.password = '';
            return connect({
              servers: url.toString(),
              ...credentials,
              name: config.serviceName,
              timeout: 2000,
              pingInterval: 1000,
              maxPingOut: 2,
              maxReconnectAttempts: 5,
              ...(url.protocol === 'tls:' ? { tls: {} } : {}),
            });
          },
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
          const broker = yield* Effect.tryPromise({
            try: async (signal) => {
              const cancel = () => {
                void nats.close();
              };
              signal.addEventListener('abort', cancel, { once: true });
              try {
                if (signal.aborted || nats.isClosed()) return false;
                await nats.rtt();
                return true;
              } finally {
                signal.removeEventListener('abort', cancel);
              }
            },
            catch: (cause) => cause,
          }).pipe(
            Effect.timeout(config.healthTimeoutMs ?? 2000),
            Effect.catch((cause) =>
              Effect.logError('NATS health check failed', { cause }).pipe(Effect.as(false))
            )
          );
          const database = yield* Effect.tryPromise({
            try: (signal) => checkDatabase(pool, signal),
            catch: (cause) => cause,
          }).pipe(
            Effect.timeout(config.healthTimeoutMs ?? 5000),
            Effect.catch((cause) =>
              Effect.logError('Database health check failed', { cause }).pipe(Effect.as(false))
            )
          );
          return {
            database,
            nats: broker,
            otel: config.otelHealthy,
          };
        }),
      };
      return probe;
    })
  );
}

async function checkDatabase(pool: Pool, signal: AbortSignal): Promise<boolean> {
  let connectionFailed = false;
  const recordError = () => {
    connectionFailed = true;
  };
  // Take error ownership in the checkout callback, before yielding to a Promise continuation.
  const client = await new Promise<PoolClient>((resolve, reject) => {
    pool.connect((cause, acquired) => {
      if (cause) return reject(cause);
      if (!acquired) return reject(new Error('Database checkout returned no client'));
      acquired.on('error', recordError);
      resolve(acquired);
    });
  });
  let released = false;
  let queryFailed = false;
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
    return !connectionFailed && !signal.aborted;
  } catch (cause) {
    queryFailed = true;
    throw cause;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!released) {
      released = true;
      client.release(queryFailed || connectionFailed || signal.aborted);
    }
    // release restores pg-pool's idle listener before this listener is removed.
    client.removeListener('error', recordError);
  }
}
