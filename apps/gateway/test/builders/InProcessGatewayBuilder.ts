import {
  type AddMethodsType,
  BaseTesterBuilder,
  type OpenSearchTesterBuilder,
  type NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';

export interface InProcessGatewayOptions {
  configOverrides?: Partial<Config>;
  logger?: boolean;
}

/** Each fixture owns its application and configuration; no global DI or environment. */
export class InProcessGatewayTesterBuilder extends BaseTesterBuilder<
  'InProcessGateway',
  [OpenSearchTesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'InProcessGateway';

  constructor(private readonly options: InProcessGatewayOptions = {}) {
    super();
  }

  addMethods<TBase extends AddMethodsType<[OpenSearchTesterBuilder, NatsTesterBuilder]>>(
    Base: TBase
  ) {
    const options = this.options;
    return class extends Base {
      private application: FastifyInstance | undefined;
      private applicationConfig: Config | undefined;
      private appHookRegistered = false;

      withInProcessApp(overrides: Partial<Config> = {}) {
        if (this.appHookRegistered) return this;
        this.appHookRegistered = true;
        this.addSetupHook(async () => {
          const search = this.opensearch.config;
          const config: Config = {
            port: 3004,
            nodeEnv: 'test',
            opensearchUrl: search.endpoint.fromHost,
            opensearchIndex: 'test_wallpapers',
            opensearchUsername: search.username,
            opensearchPassword: search.password,
            natsUrl: this.nats.config.endpoints.fromHost,
            natsStream: 'WALLPAPER',
            redisEnabled: false,
            redisHost: '127.0.0.1',
            redisPort: 6379,
            otelServiceName: 'gateway',
            mediaServiceUrl: 'http://media.example.test',
            mediaPublicPath: '/media',
            graphqlMaxDepth: 5,
            graphqlMaxComplexity: 1000,
            graphqlMaxUniqueFields: 50,
            graphqlMaxAliases: 20,
            graphqlMaxBatchSize: 10,
            graphqlIntrospectionEnabled: true,
            rateLimitEnabled: true,
            rateLimitMaxAnonymous: 100,
            rateLimitWindowMs: 60000,
            cursorSecret: 'gateway-test-secret-at-least-thirty-two-characters',
            cursorExpirationMs: 7 * 24 * 60 * 60 * 1000,
            colorSpreadStrategy: 'linear',
            ...options.configOverrides,
            ...overrides,
          };
          this.applicationConfig = config;
          this.application = await createApp(config, {
            logger: options.logger ?? false,
            enableOtel: false,
          });
        });
        this.addDestroyHook(async () => {
          await this.application?.close();
          this.application = undefined;
        });
        return this;
      }

      getGatewayConfig(): Config {
        if (!this.applicationConfig) throw new Error('Call setup() before getGatewayConfig().');
        return this.applicationConfig;
      }

      getApp(): FastifyInstance {
        if (!this.application)
          throw new Error('Call withInProcessApp() and setup() before getApp().');
        return this.application;
      }
    };
  }
}
