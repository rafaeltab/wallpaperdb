import { registerAuth } from '@wallpaperdb/auth';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import type { TimerService } from '@wallpaperdb/core/timer';
import Fastify, { type FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from './config.js';
import { DatabaseConnection } from './connections/database.js';
import { NatsConnectionManager } from './connections/nats.js';
import { registerUserCors } from './http/cors.js';
import { getOtelSdk, shutdownOtel } from './otel-init.js';
import { registerRoutes } from './routes/index.js';
import { ClerkIdentityProvider, IdentityProviderToken } from './services/clerk-identity.service.js';
import { ProfileAliasExpiryWorker } from './services/profile-alias-expiry.service.js';
import { ProfileEventRetentionService } from './services/profile-event-retention.service.js';
import { ProfileEvidenceRetentionWorker } from './services/profile-evidence-retention-worker.js';
import { ProfilePictureRetentionService } from './services/profile-picture-retention.service.js';
import { ProfileService } from './services/profile.service.js';
import { ProfilePictureStorage } from './services/profile-picture-storage.js';
import { ProfilePictureImportService } from './services/profile-picture-import.service.js';
import { ProfilePictureImportWorker } from './services/profile-picture-import-worker.js';
import { WallpaperOwnershipConsumer } from './services/consumers/wallpaper-ownership.consumer.js';
import {
  NatsProfileEventPublisher,
  ProfileOutboxPublisherWorker,
} from './services/profile-outbox-publisher.service.js';

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
  options?: {
    logger?: boolean;
    enableOtel?: boolean;
    aliasExpiryTimer?: TimerService;
    pictureImportTimer?: TimerService;
    evidenceRetentionTimer?: TimerService;
  }
): Promise<FastifyInstance> {
  container.register('config', { useValue: config });
  container.register(IdentityProviderToken, { useClass: ClerkIdentityProvider });

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

  await registerUserCors(fastify, config.nodeEnv);

  await registerAuth(fastify, {
    secretKey: config.clerkSecretKey,
    testMode: config.nodeEnv === 'test',
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

  let outboxPublisher: ProfileOutboxPublisherWorker | null = null;
  let aliasExpiryWorker: ProfileAliasExpiryWorker | null = null;
  let pictureImportWorker: ProfilePictureImportWorker | null = null;
  let evidenceRetentionWorker: ProfileEvidenceRetentionWorker | null = null;

  try {
    await container.resolve(DatabaseConnection).initialize();
    fastify.log.info('Database connection pool created');

    await container.resolve(NatsConnectionManager).initialize();
    fastify.log.info('NATS connection created');
    await container.resolve(WallpaperOwnershipConsumer).start();

    outboxPublisher = new ProfileOutboxPublisherWorker(
      container.resolve(DatabaseConnection),
      new NatsProfileEventPublisher(container.resolve(NatsConnectionManager), config),
      fastify.log
    );
    aliasExpiryWorker = new ProfileAliasExpiryWorker(
      container.resolve(DatabaseConnection),
      (reference, now) => container.resolve(ProfileService).expireDueAlias(reference, now),
      fastify.log,
      options?.aliasExpiryTimer
    );
    pictureImportWorker = new ProfilePictureImportWorker(
      async (isStopping) =>
        container.resolve(ProfilePictureImportService).importPending(isStopping),
      fastify.log,
      options?.pictureImportTimer
    );
    const eventRetention = new ProfileEventRetentionService(
      container.resolve(DatabaseConnection), config, fastify.log
    );
    const pictureRetention = new ProfilePictureRetentionService(
      container.resolve(DatabaseConnection), container.resolve(ProfilePictureStorage), fastify.log
    );
    evidenceRetentionWorker = new ProfileEvidenceRetentionWorker(
      (now, isStopping) => eventRetention.cleanupExpired(now, isStopping),
      (now, isStopping) => pictureRetention.cleanupExpired(now, isStopping),
      fastify.log,
      options?.evidenceRetentionTimer
    );
    fastify.connectionsState.connectionsInitialized = true;
    fastify.log.info('All connections initialized successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;
    await container.resolve(WallpaperOwnershipConsumer).stop();
    await aliasExpiryWorker?.stop();
    await evidenceRetentionWorker?.stop();
    await pictureImportWorker?.stop();
    container.resolve(ProfilePictureStorage).close();
    await outboxPublisher?.stop();
    await container.resolve(NatsConnectionManager).close();
    await container.resolve(DatabaseConnection).close();
    await shutdownOtel();
  });

  await registerRoutes(fastify, config);

  outboxPublisher?.start();
  fastify.log.info('Profile outbox publisher started');
  aliasExpiryWorker?.start();
  fastify.log.info('Profile alias expiry worker started');
  pictureImportWorker?.start();
  fastify.log.info('Profile picture import worker started');
  evidenceRetentionWorker?.start();
  fastify.log.info('Profile evidence retention worker started');

  return fastify;
}
