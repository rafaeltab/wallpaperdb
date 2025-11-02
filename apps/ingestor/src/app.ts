import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import {
  checkDatabaseHealth,
  closeDatabaseConnection,
  createDatabaseConnection,
} from './connections/database.js';
import {
  checkMinioHealth,
  closeMinioConnection,
  createMinioConnection,
} from './connections/minio.js';
import { checkNatsHealth, closeNatsConnection, createNatsConnection } from './connections/nats.js';
import {
  checkOtelHealth,
  initializeOpenTelemetry,
  shutdownOpenTelemetry,
} from './connections/otel.js';

// Track shutdown state
let isShuttingDown = false;
let connectionsInitialized = false;

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

  // Initialize connections
  async function initializeConnections() {
    if (connectionsInitialized) {
      return;
    }

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

      connectionsInitialized = true;
      fastify.log.info('All connections initialized successfully');
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to initialize connections');
      throw error;
    }
  }

  // Initialize connections
  await initializeConnections();

  // Health check endpoint
  fastify.get('/health', async (_request, reply) => {
    if (isShuttingDown) {
      return reply.code(503).send({
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      });
    }

    const checks = {
      database: false,
      minio: false,
      nats: false,
      otel: false,
    };

    try {
      // Check all connections
      checks.database = await checkDatabaseHealth();
      checks.minio = await checkMinioHealth(config);
      checks.nats = await checkNatsHealth();
      // OTEL is optional in tests - if disabled, consider it healthy
      checks.otel = config.nodeEnv === 'test' ? true : await checkOtelHealth();

      const allHealthy = Object.values(checks).every((check) => check === true);

      if (allHealthy) {
        return reply.code(200).send({
          status: 'healthy',
          checks,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.code(503).send({
        status: 'unhealthy',
        checks,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Health check error');
      return reply.code(503).send({
        status: 'error',
        checks,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Readiness check endpoint
  fastify.get('/ready', async (_request, reply) => {
    if (isShuttingDown || !connectionsInitialized) {
      return reply.code(503).send({
        ready: false,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.code(200).send({
      ready: true,
      timestamp: new Date().toISOString(),
    });
  });

  // Add cleanup hook
  fastify.addHook('onClose', async () => {
    isShuttingDown = true;
    await closeNatsConnection();
    await closeDatabaseConnection();
    closeMinioConnection();
    if (options?.enableOtel !== false && config.nodeEnv !== 'test') {
      await shutdownOpenTelemetry();
    }
  });

  return fastify;
}
