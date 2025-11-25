import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import Fastify, { type FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from './config.js';
import { DatabaseConnection } from './connections/database.js';
import { MinioConnection } from './connections/minio.js';
import { NatsConnectionManager } from './connections/nats.js';
import { registerRoutes } from './routes/index.js';

// Connection state interface
export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}

// Extend Fastify instance with our custom state
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
    container: typeof container;
  }
}

export async function createApp(
  config: Config,
  options?: { logger?: boolean; enableOtel?: boolean }
): Promise<FastifyInstance> {
  container.register('config', { useValue: config });

  // Create Fastify server
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

  // Register CORS for development (allow docs site to access API)
  await fastify.register(cors, {
    origin: config.nodeEnv === 'development' ? [/localhost:\d+/, /127\.0\.0\.1:\d+/] : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Register OpenAPI documentation
  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Media API',
    version: '1.0.0',
    description:
      'Wallpaper retrieval and serving service. Retrieves wallpapers from object storage with optional resizing and format conversion.',
    servers:
      config.nodeEnv === 'production'
        ? undefined
        : [
            {
              url: `http://localhost:${config.port}`,
              description: 'Local development server',
            },
          ],
  });

  // Decorate Fastify with container for access in routes
  fastify.decorate('container', container);

  // Initialize connection state
  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  // Initialize connections
  fastify.log.info('Initializing connections...');

  try {
    await container.resolve(DatabaseConnection).initialize();
    fastify.log.info('Database connection pool created');

    // Initialize MinIO connection (read-only access)
    await container.resolve(MinioConnection).initialize();
    fastify.log.info('MinIO connection created');

    // Initialize NATS connection (for event consumption)
    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');

    fastify.connectionsState.connectionsInitialized = true;
    fastify.log.info('All connections initialized successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  // Add cleanup hook
  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;
    await container.resolve(NatsConnectionManager).close();
    await container.resolve(DatabaseConnection).close();
    await container.resolve(MinioConnection).close();
  });

  // Register all routes
  await registerRoutes(fastify);

  return fastify;
}
