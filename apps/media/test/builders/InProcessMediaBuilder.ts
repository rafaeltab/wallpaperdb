import {
  type AddMethodsType,
  BaseTesterBuilder,
  type S3TesterBuilder,
  type NatsTesterBuilder,
  type PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import * as schema from '../../src/db/schema.js';

export interface InProcessMediaOptions {
  configOverrides?: Partial<Config>;
  logger?: boolean;
}
export class InProcessMediaTesterBuilder extends BaseTesterBuilder<
  'InProcessMedia',
  [PostgresTesterBuilder, S3TesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'InProcessMedia' as const;
  constructor(private readonly options: InProcessMediaOptions = {}) {
    super();
  }
  addMethods<
    TBase extends AddMethodsType<[PostgresTesterBuilder, S3TesterBuilder, NatsTesterBuilder]>,
  >(Base: TBase) {
    const options = this.options;
    return class extends Base {
      app: FastifyInstance | null = null;
      fixturePool: Pool | null = null;
      _appInitialized = false;
      withInProcessApp() {
        if (this._appInitialized) return this;
        this._appInitialized = true;
        this.withStream('PROFILE');
        this.addSetupHook(async () => {
          const postgres = this.getPostgres();
          const s3 = this.getS3();
          const nats = this.getNats();
          const config: Config = {
            nodeEnv: 'test',
            port: 0,
            databaseUrl: postgres.connectionStrings.fromHost,
            s3Endpoint: s3.endpoints.fromHost,
            s3AccessKeyId: s3.options.accessKey,
            s3SecretAccessKey: s3.options.secretKey,
            s3Bucket: s3.buckets[0] ?? 'wallpapers',
            s3Region: 'us-east-1',
            assetReferenceBucket: 'asset-references',
            natsUrl: nats.endpoints.fromHost,
            natsStream: nats.streams[0] ?? 'WALLPAPER',
            otelServiceName: 'media-test',
            maxResizeWidth: 7680,
            maxResizeHeight: 4320,
            userServiceUrl: process.env.USER_SERVICE_URL,
            userMediaServiceToken: process.env.USER_MEDIA_SERVICE_TOKEN,
            ...options.configOverrides,
          };
          this.fixturePool = new Pool({ connectionString: config.databaseUrl });
          this.app = await createApp(config, { logger: options.logger ?? false });
        });
        this.addDestroyHook(async () => {
          try {
            await this.app?.close();
          } finally {
            await this.fixturePool?.end();
            this.app = null;
            this.fixturePool = null;
          }
        });
        return this;
      }
      getFixtureDatabase() {
        if (!this.fixturePool) throw new Error('Fixture database is not initialized');
        return drizzle(this.fixturePool, { schema });
      }
      getApp(): FastifyInstance {
        if (!this.app) throw new Error('App is not initialized');
        return this.app;
      }
    };
  }
}
