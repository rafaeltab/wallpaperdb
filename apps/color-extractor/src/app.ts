import cors from '@fastify/cors';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import Fastify, { type FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from './config.js';
import { MinioConnection } from './connections/minio.js';
import { NatsConnectionManager } from './connections/nats.js';
import { getOtelSdk, shutdownOtel } from './otel-init.js';
import { registerRoutes } from './routes/index.js';
import { WallpaperUploadedConsumerService } from './services/consumers/wallpaper-uploaded-consumer.service.js';
import { ColorExtractionProcessor } from './services/color-extraction-processor.js';
import { EventsService } from './services/events.service.js';
import { HsvEmbeddingStrategy } from './services/hsv-embedding-strategy.js';
import { MinioImageReader } from './services/minio-image-reader.js';
import {
  COLORS_EXTRACTED_PUBLISHER,
  COLOR_EXTRACTION_USE_CASE,
  HISTOGRAM_PROVIDER,
  IMAGE_READER,
} from './services/ports.js';
import { SharpHistogramProvider } from './services/sharp-histogram-provider.js';

export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}

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
  container.registerSingleton(MinioConnection, MinioConnection);
  container.registerSingleton(NatsConnectionManager, NatsConnectionManager);
  container.register(HsvEmbeddingStrategy, { useClass: HsvEmbeddingStrategy });
  container.register(IMAGE_READER, { useClass: MinioImageReader });
  container.register(HISTOGRAM_PROVIDER, { useClass: SharpHistogramProvider });
  container.register(COLORS_EXTRACTED_PUBLISHER, { useClass: EventsService });
  container.register(COLOR_EXTRACTION_USE_CASE, { useClass: ColorExtractionProcessor });
  container.register(WallpaperUploadedConsumerService, {
    useClass: WallpaperUploadedConsumerService,
  });

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
    title: 'WallpaperDB Color Extractor API',
    version: '1.0.0',
    description:
      'Color extraction service for wallpapers. Extracts dominant color palettes from stored wallpaper images.',
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

  fastify.decorate('container', container);

  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  const otelSdk = getOtelSdk();
  if (otelSdk) {
    container.register('otelSdk', { useValue: otelSdk });
  }

  fastify.log.info('Initializing connections...');

  try {
    await container.resolve(MinioConnection).initialize();
    fastify.log.info('MinIO connection created');

    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');

    fastify.connectionsState.connectionsInitialized = true;
    fastify.log.info('All connections initialized successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  fastify.log.info('Starting event consumers...');
  try {
    const consumer = container.resolve(WallpaperUploadedConsumerService);

    await consumer.start();
    fastify.log.info('Event consumers started');

    fastify.decorate('consumer', consumer);
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to start event consumers');
    throw error;
  }

  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;

    if (fastify.consumer) {
      fastify.log.info('Stopping event consumers...');
      await fastify.consumer.stop();
    }

    await container.resolve(NatsConnectionManager).close();
    await container.resolve(MinioConnection).close();
    await shutdownOtel();
  });

  await registerRoutes(fastify);

  return fastify;
}
