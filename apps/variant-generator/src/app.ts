import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import Fastify, { type FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from './config.js';
import { NatsConnectionManager } from './connections/nats.js';
import { MinioConnection } from './connections/minio.js';
import { registerRoutes } from './routes/index.js';
import { getOtelSdk, shutdownOtel } from './otel-init.js';
import { WallpaperUploadedConsumerService } from './services/consumers/wallpaper-uploaded-consumer.service.js';

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
    consumer: WallpaperUploadedConsumerService;
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
    title: 'WallpaperDB Variant Generator API',
    version: '1.0.0',
    description:
      'Wallpaper variant generation service. Generates lower resolution variants of wallpapers for different device types.',
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

  // Register pre-initialized OTEL SDK (initialized in index.ts before app import)
  // This allows the SDK to be accessed via DI if needed
  const otelSdk = getOtelSdk();
  if (otelSdk) {
    container.register('otelSdk', { useValue: otelSdk });
  }

  // Initialize connections (no database for stateless service)
  fastify.log.info('Initializing connections...');

  try {
    // Initialize MinIO connection (for reading originals and uploading variants)
    await container.resolve(MinioConnection).initialize();
    fastify.log.info('MinIO connection created');

    // Initialize NATS connection (for event consumption and publishing)
    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');

    fastify.connectionsState.connectionsInitialized = true;
    fastify.log.info('All connections initialized successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  // Start event consumer
  fastify.log.info('Starting event consumers...');
  try {
    const consumer = container.resolve(WallpaperUploadedConsumerService);

    // Start consumer (non-blocking - runs in background)
    await consumer.start();
    fastify.log.info('Event consumers started');

    // Store consumer reference for shutdown
    fastify.decorate('consumer', consumer);
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to start event consumers');
    throw error;
  }

  // Add cleanup hook
  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;

    // Stop consumer first
    if (fastify.consumer) {
      fastify.log.info('Stopping event consumers...');
      await fastify.consumer.stop();
    }

    await container.resolve(NatsConnectionManager).close();
    await container.resolve(MinioConnection).close();
    await shutdownOtel();
  });

  // Register all routes
  await registerRoutes(fastify);

  return fastify;
}
