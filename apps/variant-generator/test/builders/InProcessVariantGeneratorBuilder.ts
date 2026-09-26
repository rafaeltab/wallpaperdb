import {
  type AddMethodsType,
  BaseTesterBuilder,
  type S3TesterBuilder,
  type NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { createTestLogger } from '@wallpaperdb/test-logger';

const logger = createTestLogger('InProcessVariantGeneratorBuilder');

export interface InProcessVariantGeneratorOptions {
  configOverrides?: Partial<Config>;
  logger?: boolean;
}

export class InProcessVariantGeneratorTesterBuilder extends BaseTesterBuilder<
  'InProcessVariantGenerator',
  [S3TesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'InProcessVariantGenerator' as const;
  private options: InProcessVariantGeneratorOptions;

  constructor(options: InProcessVariantGeneratorOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[S3TesterBuilder, NatsTesterBuilder]>>(Base: TBase) {
    const options = this.options;

    return class extends Base {
      app: FastifyInstance | null = null;
      _appInitialized = false;

      withInProcessApp() {
        if (this._appInitialized) {
          return this;
        }

        this._appInitialized = true;

        this.addSetupHook(async () => {
          logger.debug('[InProcessVariantGenerator] Creating app via setup hook');

          const s3 = this.getS3();
          const nats = this.getNats();
          if (!s3 || !nats) throw new Error('S3 and NATS are required');
          const config: Config = {
            nodeEnv: 'test',
            jpegQuality: 90, webpQuality: 90, pngCompressionLevel: 6,
            port: 3006,
            s3Endpoint: s3.endpoints.fromHost,
            s3AccessKeyId: s3.options.accessKey,
            s3SecretAccessKey: s3.options.secretKey,
            s3Bucket: s3.buckets[0] ?? 'wallpapers',
            s3Region: 'us-east-1',
            natsUrl: nats.endpoints.fromHost,
            natsStream: nats.streams[0] ?? 'WALLPAPER',
            otelServiceName: 'variant-generator-test',
            ...options.configOverrides,
          };

          this.app = await createApp(config, {
            logger: options.logger ?? false,
            otelHealthy: true,
          });

          logger.debug('In-process Variant Generator Fastify app ready');
        });

        this.addDestroyHook(async () => {
          if (this.app) {
            logger.debug('Closing in-process Variant Generator Fastify app...');
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
