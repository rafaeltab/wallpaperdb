import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';

export interface RedisOptions {
  image?: string;
  networkAlias?: string;
}

class RedisBuilder {
  private image = 'redis:7-alpine';
  private networkAlias = 'redis';

  withImage(image: string) {
    this.image = image;
    return this;
  }

  withNetworkAlias(alias: string) {
    this.networkAlias = alias;
    return this;
  }

  build(): RedisOptions {
    return {
      image: this.image,
      networkAlias: this.networkAlias,
    };
  }
}

export interface RedisConfig {
  container: StartedRedisContainer;
  endpoint: string;
  options: RedisOptions;
}

/**
 * Helper class providing namespaced Redis operations.
 * Currently minimal, but provides a consistent structure for future expansion.
 */
class RedisHelpers {
  constructor(private tester: TesterInstance<RedisTesterBuilder>) {}

  /**
   * Get the Redis configuration.
   * @throws Error if Redis not initialized
   */
  get config(): RedisConfig {
    // biome-ignore lint/suspicious/noExplicitAny: Need to access private property from parent tester instance
    const config = (this.tester as any)._redisConfig;
    if (!config) {
      throw new Error('Redis not initialized. Call withRedis() and setup() first.');
    }
    return config;
  }
}

export class RedisTesterBuilder extends BaseTesterBuilder<
  'redis',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder]
> {
  name = 'redis' as const;

  addMethods<
    TBase extends AddMethodsType<[DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder]>,
  >(Base: TBase) {
    return class Redis extends Base {
      /** @internal */
      _redisConfig: RedisConfig | undefined;
      readonly redis = new RedisHelpers(this as TesterInstance<RedisTesterBuilder>);

      withRedis(configure: (redis: RedisBuilder) => RedisBuilder = (a) => a) {
        const options = configure(new RedisBuilder()).build();
        const { image = 'redis:7-alpine', networkAlias = 'redis' } = options;

        this.addSetupHook(async () => {
          console.log('Starting Redis container...');

          // Auto-detect if network is available
          const dockerNetwork = this.docker.network;

          let container = new RedisContainer(image);

          if (dockerNetwork) {
            container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
          }

          const started = await container.start();

          const host = dockerNetwork ? networkAlias : started.getHost();
          const port = dockerNetwork ? 6379 : started.getPort();
          const url = `redis://${host}:${port}`;

          this._redisConfig = {
            container: started,
            endpoint: url,
            options: options,
          };

          console.log(`Redis started: ${url}`);
        });

        this.addDestroyHook(async () => {
          if (this._redisConfig) {
            console.log('Stopping Redis container...');
            await this._redisConfig.container.stop();
          }
        });

        return this;
      }
    };
  }
}
