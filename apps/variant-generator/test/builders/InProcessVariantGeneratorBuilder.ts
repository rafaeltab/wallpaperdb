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

/**
 * Options for InProcessVariantGeneratorMixin
 */
export interface InProcessVariantGeneratorOptions {
  /** Config overrides (e.g., quality settings) */
  configOverrides?: Partial<Config>;
  /** Enable Fastify logger (default: false) */
  logger?: boolean;
}

/**
 * Mixin that creates an in-process Fastify app for the Variant Generator service.
 * This is ideal for integration tests that don't require Docker containers.
 *
 * Note: This service is stateless - no database connection needed.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(MinioTesterBuilder)
 *   .with(NatsTesterBuilder)
 *   .with(InProcessVariantGeneratorTesterBuilder)
 *   .build();
 *
 * const app = tester.getApp();
 * const response = await app.inject({ method: 'GET', url: '/health' });
 * ```
 */
export class InProcessVariantGeneratorTesterBuilder extends BaseTesterBuilder<
  'InProcessVariantGenerator',
  [MinioTesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'InProcessVariantGenerator' as const;
  private options: InProcessVariantGeneratorOptions;

  constructor(options: InProcessVariantGeneratorOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[MinioTesterBuilder, NatsTesterBuilder]>>(Base: TBase) {
    const options = this.options;

    return class extends Base {
      private app: FastifyInstance | null = null;
      private _appInitialized = false;

      withVariantGeneratorEnvironment() {
        this.addSetupHook(async () => {
          console.log('[InProcessVariantGenerator] Setting up environment variables');
          const minio = this.getMinio();
          const nats = this.getNats();

          if (!minio || !nats) {
            throw new Error(
              'InProcessVariantGeneratorTesterBuilder requires MinioTesterBuilder and NatsTesterBuilder'
            );
          }

          console.log('Creating in-process Fastify app for Variant Generator service...');

          // Set environment variables for loadConfig()
          // Note: No DATABASE_URL - this service is stateless
          process.env.NODE_ENV = 'test';
          process.env.PORT = '3004';
          process.env.S3_ENDPOINT = minio.endpoints.fromHost;
          process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
          process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
          process.env.S3_BUCKET = minio.buckets.length > 0 ? minio.buckets[0] : 'wallpapers';
          process.env.NATS_URL = nats.endpoints.fromHost;
          process.env.NATS_STREAM = nats.streams.length > 0 ? nats.streams[0] : 'WALLPAPER';
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

          // Apply config overrides
          if (options.configOverrides) {
            for (const [key, value] of Object.entries(options.configOverrides)) {
              if (value !== undefined) {
                // Convert camelCase to SCREAMING_SNAKE_CASE
                const envKey = key
                  .replace(/([A-Z])/g, '_$1')
                  .toUpperCase()
                  .replace(/^_/, '');
                process.env[envKey] = String(value);
              }
            }
          }

          console.log('[InProcessVariantGenerator] Environment variables set up');
        });
        return this;
      }

      /**
       * Enable in-process Fastify app creation during setup.
       * The app will be created after all infrastructure is ready.
       */
      withInProcessApp() {
        if (this._appInitialized) {
          return this; // Already registered
        }

        this._appInitialized = true;
        this.withVariantGeneratorEnvironment();

        this.addSetupHook(async () => {
          console.log('[InProcessVariantGenerator] Creating app via setup hook');

          // Import config at runtime to pick up environment variables
          const { loadConfig } = await import('../../src/config.js');
          const config = loadConfig();
          container.registerInstance('config', config);

          // Create Fastify app
          this.app = await createApp(config, {
            logger: options.logger ?? false,
            enableOtel: false,
          });

          console.log('In-process Variant Generator Fastify app ready');
        });

        this.addDestroyHook(async () => {
          if (this.app) {
            console.log('Closing in-process Variant Generator Fastify app...');
            await this.app.close();
            this.app = null;
          }
        });

        return this;
      }

      /**
       * Get the Fastify app instance
       */
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
