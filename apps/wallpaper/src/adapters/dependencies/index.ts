import { Worker } from 'node:worker_threads';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { Effect, Layer, Schema, Semaphore } from 'effect';
import type { ConnectionOptions } from 'nats';
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
          try: () => startBroker(config),
          catch: (cause) => new DependencyStartupFailure({ cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('NATS connection failed', { cause: error.cause })
          )
        ),
        (connection) => Effect.promise(() => connection.close())
      );
      const brokerChecks = yield* Semaphore.make(1);
      const probe: AvailabilityProbe = {
        inspect: Effect.fn('dependencies.inspect')(function* () {
          const broker = yield* Effect.tryPromise({
            try: (signal) => nats.inspect(signal),
            catch: (cause) => cause,
          }).pipe(
            brokerChecks.withPermit,
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

async function startBroker(config: DependencyProbeConfig) {
  const broker = brokerProbe(brokerOptions(config));
  const deadline = setTimeout(() => void broker.close(), 2000);
  try {
    await broker.start();
    return broker;
  } catch (cause) {
    await broker.close();
    throw cause;
  } finally {
    clearTimeout(deadline);
  }
}

function brokerOptions(config: DependencyProbeConfig): ConnectionOptions {
  const url = new URL(config.natsUrl);
  const credentials =
    url.username || url.password
      ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
      : {};
  url.username = '';
  url.password = '';
  return {
    servers: url.toString(),
    ...credentials,
    name: config.serviceName,
    timeout: 2000,
    pingInterval: 1000,
    maxPingOut: 2,
    maxReconnectAttempts: 5,
    ...(url.protocol === 'tls:' ? { tls: {} } : {}),
  };
}

function brokerProbe(options: ConnectionOptions) {
  let current = brokerWorker(options);
  let stopped = false;
  return {
    start: () => current.ready,
    async inspect(signal: AbortSignal): Promise<boolean> {
      if (stopped || signal.aborted) return false;
      if (current.closed) {
        await current.close();
        if (stopped || signal.aborted) return false;
        current = brokerWorker(options);
      }
      const active = current;
      const cancel = () => void active.close();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) cancel();
        await active.ready;
        await active.inspect();
        return !stopped && !signal.aborted && !active.closed;
      } catch (cause) {
        await active.close();
        throw cause;
      } finally {
        signal.removeEventListener('abort', cancel);
        if (stopped || signal.aborted) await active.close();
      }
    },
    async close() {
      stopped = true;
      await current.close();
    },
  };
}

/** Termination owns native sockets even when nats.connect has not received INFO.
 * The SDK's acquisition timeout alone cannot release that pre-INFO transport. */
function brokerWorker(options: ConnectionOptions) {
  const source = import.meta.url.endsWith('.ts');
  const worker = new Worker(
    new URL(source ? './broker-worker.ts' : './broker-worker.mjs', import.meta.url),
    {
      workerData: options,
      execArgv: source ? ['--experimental-strip-types'] : [],
    }
  );
  let connected = () => {};
  let connectionFailed = (_cause: unknown) => {};
  const ready = new Promise<void>((resolve, reject) => {
    connected = resolve;
    connectionFailed = reject;
  });
  let request: { resolve: () => void; reject: (cause: unknown) => void } | undefined;
  let closed = false;
  let termination: Promise<void> | undefined;
  function close() {
    if (!termination) {
      closed = true;
      const cause = new Error('NATS probe worker closed');
      connectionFailed(cause);
      request?.reject(cause);
      termination = worker.terminate().then(() => undefined);
    }
    return termination;
  }
  function fail(cause: unknown) {
    connectionFailed(cause);
    request?.reject(cause);
    void close();
  }
  worker.on('message', (message: unknown) => {
    if (message === 'connected') connected();
    else if (message === 'healthy') request?.resolve();
    else fail(message instanceof Error ? message : new Error('Invalid NATS probe worker response'));
  });
  worker.on('error', fail);
  worker.once('exit', (code) => fail(new Error(`NATS probe worker exited (${code})`)));
  return {
    ready,
    get closed() {
      return closed;
    },
    inspect() {
      if (closed) return Promise.reject(new Error('NATS probe worker is closed'));
      return new Promise<void>((resolve, reject) => {
        request = { resolve, reject };
        worker.postMessage('inspect');
      }).finally(() => {
        request = undefined;
      });
    },
    close,
  };
}

async function checkDatabase(pool: Pool, signal: AbortSignal): Promise<boolean> {
  let connectionFailure: Error | undefined;
  const recordError = (cause: Error) => {
    connectionFailure ??= cause;
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
    // pg can finish the query before emitting an independent fatal client error.
    if (connectionFailure) throw connectionFailure;
    return !signal.aborted;
  } catch (cause) {
    queryFailed = true;
    throw cause;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!released) {
      released = true;
      client.release(queryFailed || connectionFailure !== undefined || signal.aborted);
    }
    // release restores pg-pool's idle listener before this listener is removed.
    client.removeListener('error', recordError);
  }
}
