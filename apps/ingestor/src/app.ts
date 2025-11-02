import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { closeDatabaseConnection, createDatabaseConnection } from './connections/database.js';
import { closeMinioConnection, createMinioConnection } from './connections/minio.js';
import { closeNatsConnection, createNatsConnection } from './connections/nats.js';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from './connections/otel.js';
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
  }
}

export async function createApp(
  config: Config,
  options?: { logger?: boolean; enableOtel?: boolean }
): Promise<FastifyInstance> {
  // Initialize OpenTelemetry first (for instrumentation) - skip in tests by default
  if (options?.enableOtel !== false && config.nodeEnv !== 'test') {
    initializeOpenTelemetry(config);
  }

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

  // Initialize connection state
  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  // Initialize connections
  fastify.log.info('Initializing connections...');

  try {
    // Initialize database connection
    createDatabaseConnection(config);
    fastify.log.info('Database connection pool created');

    // Initialize MinIO connection
    createMinioConnection(config);
    fastify.log.info('MinIO connection created');

    // Initialize NATS connection
    await createNatsConnection(config);
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
    await closeNatsConnection();
    await closeDatabaseConnection();
    closeMinioConnection();
    if (options?.enableOtel !== false && config.nodeEnv !== 'test') {
      await shutdownOpenTelemetry();
    }
  });

  // Register all routes
  await registerRoutes(fastify, config);

  return fastify;
}
