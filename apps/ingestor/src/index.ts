import Fastify from 'fastify';
import { loadConfig } from './config.js';
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

// Load configuration
const config = loadConfig();

// Initialize OpenTelemetry first (for instrumentation)
initializeOpenTelemetry(config);

// Create Fastify server
const fastify = Fastify({
  logger: {
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
  },
});

// Track shutdown state
let isShuttingDown = false;

// Initialize connections
let connectionsInitialized = false;

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
    checks.otel = await checkOtelHealth();

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

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  fastify.log.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Close HTTP server
    await fastify.close();
    fastify.log.info('HTTP server closed');

    // Close NATS connection
    await closeNatsConnection();
    fastify.log.info('NATS connection closed');

    // Close database connection
    await closeDatabaseConnection();
    fastify.log.info('Database connection closed');

    // Close MinIO connection (no-op, but for consistency)
    closeMinioConnection();
    fastify.log.info('MinIO connection closed');

    // Shutdown OpenTelemetry
    await shutdownOpenTelemetry();

    fastify.log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    fastify.log.error({ err: error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
async function start() {
  try {
    // Initialize all connections
    await initializeConnections();

    // Start Fastify server
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    fastify.log.info(`Server is running on port ${config.port}`);
    fastify.log.info(`Health check available at http://localhost:${config.port}/health`);
    fastify.log.info(`Readiness check available at http://localhost:${config.port}/ready`);
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the application
start();
