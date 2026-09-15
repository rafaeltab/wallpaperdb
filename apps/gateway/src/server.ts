import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import type { Config } from './config.js';

export interface RunningGateway {
  readonly address: string;
  stop(): Promise<void>;
}

/** Bootstrap lifecycle also supports explicit shutdown by an embedding process. */
export async function startGateway(
  config: Config,
  sdk: NodeSDK | null
): Promise<RunningGateway | undefined> {
  let app: FastifyInstance | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      try {
        await app?.close();
      } finally {
        await sdk?.shutdown();
      }
    })();
    return stopping;
  };
  const shutdown = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  try {
    app = await createApp(config, { logger: true, otelHealthy: sdk !== null });
    // Fastify lifecycle hooks must be registered before the server starts listening.
    app.addHook('onClose', async () => {
      process.removeListener('SIGTERM', shutdown);
      process.removeListener('SIGINT', shutdown);
    });
    const address = await app.listen({ port: config.port, host: '0.0.0.0' });
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { address, stop };
  } catch {
    await stop();
    process.exitCode = 1;
    console.error('Gateway failed to start');
    return undefined;
  }
}
