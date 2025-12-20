import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import type { CleanupTesterBuilder } from './CleanupTesterBuilder.js';

export interface RedisOptions {
  image?: string;
  networkAlias?: string;
}

class RedisBuilder {
  image = 'redis:7-alpine';
  networkAlias = 'redis';

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
  endpoints: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
    directIp: string;
  };
  host: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
    directIp: string;
  };
  port: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
    directIp: string;
  };
  options: RedisOptions;
}

/**
 * Helper class providing namespaced Redis operations.
 * Currently minimal, but provides a consistent structure for future expansion.
 */
class RedisHelpers {
  tester: TesterInstance<RedisTesterBuilder>;

  constructor(tester: TesterInstance<RedisTesterBuilder>) {
    this.tester = tester;
  }

  /**
   * Get the Redis configuration.
   * @throws Error if Redis not initialized
   */
  get config(): RedisConfig {
    const config = this.tester._redisConfig;
    if (!config) {
      throw new Error('Redis not initialized. Call withRedis() and setup() first.');
    }
    return config;
  }

  /**
   * Get the Redis configuration.
   */
  tryGetConfig(): RedisConfig | undefined {
    return this.tester._redisConfig;
  }
}

export class RedisTesterBuilder extends BaseTesterBuilder<
  'redis',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
> {
  name = 'redis' as const;

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
    >,
  >(Base: TBase) {
    return class Redis extends Base {
      /** @internal */
      _redisConfig: RedisConfig | undefined;
      readonly redis = new RedisHelpers(this as TesterInstance<RedisTesterBuilder>);

      withRedisAutoCleanup() {
        this.addCleanupHook(async () => {
          const redisContainer = this.redis.config.container;
          await redisContainer.exec(['redis-cli', 'FLUSHALL']);
        });
        return this;
      }

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
          const ip = started.getIpAddress('bridge');
          const host = {
            networked: networkAlias,
            fromHost: started.getHost(),
            fromHostDockerInternal: 'host.docker.internal',
            directIp: ip,
          };
          const port = {
            networked: '6379',
            fromHost: started.getPort().toString(),
            fromHostDockerInternal: started.getPort().toString(),
            directIp: '6379',
          };

          const endpoints = {
            networked: `redis://${host.networked}:${port.networked}`,
            fromHost: `redis://${host.fromHost}:${port.fromHost}`,
            fromHostDockerInternal: `redis://${host.fromHostDockerInternal}:${port.fromHostDockerInternal}`,
            directIp: `redis://${host.directIp}:${port.directIp}`,
          };

          this._redisConfig = {
            container: started,
            endpoints: endpoints,
            host: host,
            port: port,
            options: options,
          };

          console.log(
            `Redis started: ${endpoints.networked} (internal) ${endpoints.fromHost} (from host) ${endpoints.fromHostDockerInternal} (from host.docker.internal)`
          );
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
