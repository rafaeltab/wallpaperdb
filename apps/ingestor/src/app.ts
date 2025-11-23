import Fastify, { type FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import type { Config } from './config.js';
import { DatabaseConnection } from './connections/database.js';
import { MinioConnection } from './connections/minio.js';
import { NatsConnectionManager } from './connections/nats.js';
import { OpenTelemetryConnection } from './connections/otel.js';
import { RedisConnection } from './connections/redis.js';
import { registerRoutes } from './routes/index.js';
import { UploadSuccessResponseJsonSchema, uploadBodySchemaForDocs } from './routes/schemas/upload.schema.js';
import { RateLimitService } from './services/rate-limit.service.js';
import { DefaultValidationLimitsService } from './services/validation-limits.service.js';
import { SystemTimeService } from './services/core/time.service.js';
import { FastifyLogger } from './services/core/logger.service.js';

// Connection state interface
export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}

// Extend Fastify instance with our custom state
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
    rateLimitService: RateLimitService;
    container: typeof container;
  }
}

export async function createApp(
  config: Config,
  options?: { logger?: boolean; enableOtel?: boolean }
): Promise<FastifyInstance> {
  container.register('config', { useValue: config });
  container.register('ValidationLimitsService', {
    useClass: DefaultValidationLimitsService,
  });
  // Register TimeService as singleton instance for testability
  container.register('TimeService', { useValue: new SystemTimeService() });

  // Initialize OpenTelemetry first (for instrumentation) - skip in tests by default
  if (options?.enableOtel !== false && config.nodeEnv !== 'test') {
    await container.resolve(OpenTelemetryConnection).initialize();
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

  container.register('Logger', { useValue: new FastifyLogger(fastify.log) });

  // Register OpenAPI documentation
  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Ingestor API',
    version: '1.0.0',
    description: 'Wallpaper upload and ingestion service. Accepts wallpaper uploads, validates files, stores them in object storage, and publishes events for downstream processing.',
    servers: config.nodeEnv === 'production'
      ? undefined
      : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
    additionalSchemas: {
      UploadSuccessResponse: UploadSuccessResponseJsonSchema,
    },
    multipartBodies: [
      {
        url: '/upload',
        schema: uploadBodySchemaForDocs,
        errorResponses: [
          { statusCode: 400, description: 'Validation error. The file format, size, or dimensions are invalid.' },
          { statusCode: 409, description: 'Duplicate file. A file with the same content hash already exists for this user.' },
          { statusCode: 413, description: 'File too large. The file exceeds the maximum allowed size.' },
          { statusCode: 429, description: 'Rate limit exceeded. Too many upload requests in a short period.' },
          { statusCode: 500, description: 'Internal server error. An unexpected error occurred during processing.' },
        ],
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

    // Initialize MinIO connection
    await container.resolve(MinioConnection).initialize();
    fastify.log.info('MinIO connection created');

    // Initialize NATS connection
    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');

    // Initialize Redis connection (optional - for rate limiting)
    if (config.redisEnabled) {
      await container.resolve(RedisConnection).initialize();
      fastify.log.info('Redis connection created');
    }

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
    await container.resolve(RedisConnection).close();
    await container.resolve(OpenTelemetryConnection).close();
  });

  // Initialize custom rate limiting service
  // (Per-user rate limiting applied in upload route after userId extraction)
  const rateLimitService = container.resolve(RateLimitService);
  fastify.decorate('rateLimitService', rateLimitService);
  const rateLimitStore = config.redisEnabled ? 'Redis' : 'in-memory';
  fastify.log.info(`Rate limiting configured (store: ${rateLimitStore})`);

  // Register all routes
  await registerRoutes(fastify, config);

  return fastify;
}
