import crypto from 'node:crypto';
import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import Fastify, { type FastifyInstance } from 'fastify';
import mercurius from 'mercurius';
import { container } from 'tsyringe';
import type { Config } from './config.js';
import { NatsConnectionManager } from './connections/nats.js';
import { OpenSearchConnection } from './connections/opensearch.js';
import { RedisConnection } from './connections/redis.js';
import { WallpaperUploadedConsumer } from './consumers/wallpaper-uploaded.consumer.js';
import { WallpaperVariantAvailableConsumer } from './consumers/wallpaper-variant-available.consumer.js';
import { RateLimitExceededError } from './errors/graphql-errors.js';
import { Resolvers } from './graphql/resolvers.js';
import { schema } from './graphql/schema.js';
import { getValidationRules } from './graphql/validation-rules.js';
import { getOtelSdk } from './otel-init.js';
import { registerRoutes } from './routes/index.js';
import { IndexManagerService } from './services/index-manager.service.js';
import { QueryComplexityService } from './services/query-complexity.service.js';
import { GraphQLRateLimitService } from './services/rate-limit.service.js';

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
  // Register config in DI container
  container.register('config', { useValue: config });

  // Register pre-initialized OTEL SDK
  const otelSdk = getOtelSdk();
  if (otelSdk) {
    container.register('otelSdk', { useValue: otelSdk });
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

  // Attach container to Fastify instance
  fastify.decorate('container', container);

  // Initialize connection state
  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  // Register CORS for development
  await fastify.register(cors, {
    origin: config.nodeEnv === 'development' ? [/localhost:\d+/, /127\.0\.0\.1:\d+/] : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Register OpenAPI documentation
  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Gateway API',
    version: '1.0.0',
    description:
      'GraphQL gateway for querying wallpapers. Provides read-optimized access with flexible filtering capabilities.',
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

  // Add preHandler hook for batch size limiting and rate limiting
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url === '/graphql' && request.method === 'POST') {
      // 1. Check if request is a batch query
      if (Array.isArray(request.body)) {
        const batchSize = request.body.length;

        if (batchSize > config.graphqlMaxBatchSize) {
          recordCounter('graphql.security.batch_exceeded', 1, {
            batchSize,
            threshold: config.graphqlMaxBatchSize,
          });

          return reply.code(400).send({
            errors: [
              {
                message:
                  config.nodeEnv === 'production'
                    ? 'Batch validation failed'
                    : `Batch size ${batchSize} exceeds maximum ${config.graphqlMaxBatchSize}`,
                extensions: {
                  code: 'BATCH_LIMIT_EXCEEDED',
                },
              },
            ],
          });
        }
      }

      // 2. Check rate limit
      const rateLimitService = container.resolve(GraphQLRateLimitService);
      const ip = request.ip;
      const userAgent = request.headers['user-agent'];

      try {
        const result = await rateLimitService.checkRateLimit(ip, userAgent);

        // Add rate limit headers
        reply.header('X-RateLimit-Limit', String(config.rateLimitMaxAnonymous));
        reply.header('X-RateLimit-Remaining', String(result.remaining));
        reply.header('X-RateLimit-Reset', String(result.reset));
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          recordCounter('graphql.security.rate_limited', 1, {
            ip: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 8), // Hash for privacy
          });

          return reply
            .code(429)
            .header('Retry-After', String(Math.ceil(error.retryAfter / 1000)))
            .send({
              errors: [
                {
                  message: 'Rate limit exceeded',
                  extensions: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    retryAfter: error.retryAfter,
                  },
                },
              ],
            });
        }
        throw error;
      }
    }
  });

  // Register GraphQL with Mercurius
  const resolversInstance = container.resolve(Resolvers);
  await fastify.register(mercurius, {
    schema,
    resolvers: resolversInstance.getResolvers(),
    graphiql: config.nodeEnv === 'development', // Enable GraphiQL in development
    path: '/graphql',
    queryDepth: config.graphqlMaxDepth, // Built-in depth limiting
    validationRules: getValidationRules(config), // Custom validation rules (introspection control)
  });

  // Add GraphQL security hooks
  fastify.after(() => {
    const complexityService = container.resolve(QueryComplexityService);

    // preExecution hook for complexity and breadth analysis
    fastify.graphql.addHook('preExecution', async (_schema, document, _context, variables) => {
      return await withSpan('graphql.security_check', {}, async (span) => {
        // Check breadth (unique fields and aliases)
        complexityService.checkBreadth(document);

        // Calculate and validate complexity
        const complexity = complexityService.calculateComplexity(document, variables ?? {});
        span.setAttribute('graphql.complexity', complexity);
        recordHistogram('graphql.query.complexity', complexity);

        complexityService.validateComplexity(complexity);
      });
    });
  });

  // Initialize connections
  fastify.log.info('Initializing connections...');

  try {
    // Connect to Redis (if enabled)
    const redis = container.resolve(RedisConnection);
    if (config.redisEnabled) {
      await redis.initialize();
      fastify.log.info('Redis connection established');
    } else {
      fastify.log.info('Redis disabled - using in-memory fallback for rate limiting');
    }

    // Connect to OpenSearch
    const opensearch = container.resolve(OpenSearchConnection);
    await opensearch.initialize();
    fastify.log.info('OpenSearch connection established');

    // Connect to NATS
    const natsManager = container.resolve(NatsConnectionManager);
    await natsManager.initialize();
    fastify.log.info('NATS connection established');

    // Start event consumers

    const variantConsumer = container.resolve(WallpaperVariantAvailableConsumer);
    await variantConsumer.start();
    fastify.log.info('WallpaperVariantAvailableConsumer started');

    const uploadedConsumer = container.resolve(WallpaperUploadedConsumer);
    await uploadedConsumer.start();
    fastify.log.info('WallpaperUploadedConsumer started');

    // Mark connections as initialized
    fastify.connectionsState.connectionsInitialized = true;
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  try {
    await container.resolve(IndexManagerService).createIndex();
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to create required indexes');
    throw error;
  }

  // Register HTTP routes (health checks, etc.)
  await registerRoutes(fastify);

  // Graceful shutdown handler
  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;

    fastify.log.info('Stopping event consumers...');
    const uploadedConsumer = container.resolve(WallpaperUploadedConsumer);
    await uploadedConsumer.stop();

    const variantConsumer = container.resolve(WallpaperVariantAvailableConsumer);
    await variantConsumer.stop();
    fastify.log.info('Event consumers stopped');

    fastify.log.info('Closing NATS connection...');
    const natsManager = container.resolve(NatsConnectionManager);
    await natsManager.close();
    fastify.log.info('NATS connection closed');

    fastify.log.info('Closing OpenSearch connection...');
    const opensearch = container.resolve(OpenSearchConnection);
    await opensearch.close();
    fastify.log.info('OpenSearch connection closed');

    if (config.redisEnabled) {
      fastify.log.info('Closing Redis connection...');
      const redis = container.resolve(RedisConnection);
      await redis.close();
      fastify.log.info('Redis connection closed');
    }
  });

  return fastify;
}
