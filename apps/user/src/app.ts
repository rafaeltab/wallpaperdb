import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import type { Config } from './config.js';
import { NatsConnectionManager } from './connections/nats.js';
import { DatabaseConnection } from './connections/database.js';
import { registerRoutes } from './routes/index.js';
import { getOtelSdk, shutdownOtel } from './otel-init.js';

export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
    container: typeof container;
  }

  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}

export async function createApp(
  config: Config,
  options?: { logger?: boolean; enableOtel?: boolean }
): Promise<FastifyInstance> {
  container.register('config', { useValue: config });

  const otelSdk = getOtelSdk();
  if (otelSdk) {
    container.register('otelSdk', { useValue: otelSdk });
  }

  const fastify = Fastify({
    logger:
      options?.logger !== false
        ? {
            level: config.nodeEnv === 'development' ? 'debug' : 'info',
            transport:
              config.nodeEnv === 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                      translateTime: 'HH:MM:ss Z',
                      ignore: 'pid,hostname',
                    },
                  }
                : undefined,
          }
        : false,
  });

  await fastify.register(cors, {
    origin: config.nodeEnv === 'development' ? [/localhost:\d+/, /127\.0\.0\.1:\d+/] : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  await registerOpenAPI(fastify, {
    title: 'WallpaperDB User API',
    version: '1.0.0',
    description:
      'User management service. Tracks user sign-ups, profiles, and publishes user events via NATS.',
    servers:
      config.nodeEnv === 'production'
        ? undefined
        : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
  });

  fastify.decorate('container', container);

  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  fastify.log.info('Initializing connections...');

  try {
    await container.resolve(DatabaseConnection).initialize();
    fastify.log.info('Database connection pool created');

    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');

    fastify.connectionsState.connectionsInitialized = true;
    fastify.log.info('All connections initialized successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;
    await container.resolve(NatsConnectionManager).close();
    await container.resolve(DatabaseConnection).close();
    await shutdownOtel();
  });

  await registerRoutes(fastify, config);

  return fastify;
}
