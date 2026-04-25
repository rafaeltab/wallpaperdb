import {
  type AddMethodsType,
  BaseTesterBuilder,
  type MinioTesterBuilder,
  type NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { createTestLogger } from '@wallpaperdb/test-logger';

const logger = createTestLogger('InProcessColorExtractorBuilder');

export interface InProcessColorExtractorOptions {
  configOverrides?: Partial<Config>;
  logger?: boolean;
}

export class InProcessColorExtractorTesterBuilder extends BaseTesterBuilder<
  'InProcessColorExtractor',
  [MinioTesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'InProcessColorExtractor' as const;
  private options: InProcessColorExtractorOptions;

  constructor(options: InProcessColorExtractorOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[MinioTesterBuilder, NatsTesterBuilder]>>(
    Base: TBase
  ) {
    const options = this.options;

    return class extends Base {
      app: FastifyInstance | null = null;
      _appInitialized = false;

      withColorExtractorEnvironment() {
        this.addSetupHook(async () => {
          logger.debug('[InProcessColorExtractor] Setting up environment variables');
          const minio = this.getMinio();
          const nats = this.getNats();

          if (!minio || !nats) {
            throw new Error(
              'InProcessColorExtractorTesterBuilder requires MinioTesterBuilder and NatsTesterBuilder'
            );
          }

          logger.debug('Creating in-process Fastify app for Color Extractor service...');

          process.env.NODE_ENV = 'test';
          process.env.PORT = '3004';
          process.env.S3_ENDPOINT = minio.endpoints.fromHost;
          process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
          process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
          process.env.S3_BUCKET = minio.buckets.length > 0 ? minio.buckets[0] : 'wallpapers';
          process.env.NATS_URL = nats.endpoints.fromHost;
          process.env.NATS_STREAM = nats.streams.length > 0 ? nats.streams[0] : 'WALLPAPER';
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

          if (options.configOverrides) {
            for (const [key, value] of Object.entries(options.configOverrides)) {
              if (value !== undefined) {
                const envKey = key
                  .replace(/([A-Z])/g, '_$1')
                  .toUpperCase()
                  .replace(/^_/, '');
                process.env[envKey] = String(value);
              }
            }
          }

          logger.debug('[InProcessColorExtractor] Environment variables set up');
        });
        return this;
      }

      withInProcessApp() {
        if (this._appInitialized) {
          return this;
        }

        this._appInitialized = true;
        this.withColorExtractorEnvironment();

        this.addSetupHook(async () => {
          logger.debug('[InProcessColorExtractor] Creating app via setup hook');

          const { loadConfig } = await import('../../src/config.js');
          const config = loadConfig();
          container.registerInstance('config', config);

          this.app = await createApp(config, {
            logger: options.logger ?? false,
            enableOtel: false,
          });

          logger.debug('In-process Color Extractor Fastify app ready');
        });

        this.addDestroyHook(async () => {
          if (this.app) {
            logger.debug('Closing in-process Color Extractor Fastify app...');
            await this.app.close();
            this.app = null;
          }
        });

        return this;
      }

      getApp(): FastifyInstance {
        if (!this.app) {
          throw new Error(
            'App not initialized. Did you call withInProcessApp() and setup() first?'
          );
        }
        return this.app;
      }
    };
  }
}
