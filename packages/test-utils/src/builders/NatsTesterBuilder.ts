import {
  createNatsContainer,
  type NatsContainerOptions,
  type StartedNatsContainer,
} from '@wallpaperdb/testcontainers';
import {
  connect,
  type JetStreamClient,
  type NatsConnection,
  type StreamConfig,
  type StreamInfo,
} from 'nats';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import type { CleanupTesterBuilder } from './CleanupTesterBuilder.js';

export interface NatsOptions {
  image?: string;
  jetStream?: boolean;
  networkAlias?: string;
}

class NatsBuilder {
  private image = 'nats:2.10-alpine';
  private enableJetStream = false;
  private networkAlias = 'nats';

  withImage(image: string) {
    this.image = image;
    return this;
  }

  withJetstream() {
    this.enableJetStream = true;
    return this;
  }

  withNetworkAlias(alias: string) {
    this.networkAlias = alias;
    return this;
  }

  build(): NatsOptions {
    return {
      image: this.image,
      jetStream: this.enableJetStream,
      networkAlias: this.networkAlias,
    };
  }
}

export interface NatsConfig {
  container: StartedNatsContainer;
  endpoint: string;
  externalEndpoint: string;
  options: NatsOptions;
  streams: string[];
}

/**
 * Helper class providing namespaced NATS operations.
 * Manages cached NATS connections and provides JetStream helpers.
 */
class NatsHelpers {
  private connection: NatsConnection | undefined;
  private jsClient: JetStreamClient | undefined;

  constructor(private tester: TesterInstance<NatsTesterBuilder>) {}

  /**
   * Get the NATS configuration.
   * @throws Error if NATS not initialized
   */
  get config(): NatsConfig {
    // biome-ignore lint/suspicious/noExplicitAny: Need to access private property from parent tester instance
    const config = (this.tester as any)._natsConfig;
    if (!config) {
      throw new Error('NATS not initialized. Call withNats() and setup() first.');
    }
    return config;
  }

  /**
   * Get a cached NATS connection.
   * Creates the connection on first access and reuses it.
   *
   * Uses the external endpoint (host-accessible) for operations initiated from test code.
   * This ensures compatibility with Docker networks where internal aliases aren't resolvable from host.
   *
   * @returns NATS connection
   *
   * @example
   * ```typescript
   * const nc = tester.nats.getConnection();
   * await nc.publish('subject', JSON.stringify({ foo: 'bar' }));
   * ```
   */
  async getConnection(): Promise<NatsConnection> {
    if (!this.connection) {
      this.connection = await connect({ servers: this.config.externalEndpoint });
    }
    return this.connection;
  }

  /**
   * Get a cached JetStream client.
   * Creates the client on first access and reuses it.
   *
   * @returns JetStream client
   *
   * @example
   * ```typescript
   * const js = await tester.nats.getJsClient();
   * await js.publish('wallpaper.uploaded', JSON.stringify({ id: 'wlpr_123' }));
   * ```
   */
  async getJsClient(): Promise<JetStreamClient> {
    if (!this.jsClient) {
      const nc = await this.getConnection();
      this.jsClient = nc.jetstream();
    }
    return this.jsClient;
  }

  /**
   * Publish an event to a JetStream subject.
   * Automatically JSON-stringifies the data.
   *
   * @param subject - Subject name
   * @param data - Data to publish (will be JSON-stringified)
   *
   * @example
   * ```typescript
   * await tester.nats.publishEvent('wallpaper.uploaded', { id: 'wlpr_123', userId: 'user_456' });
   * ```
   */
  async publishEvent(subject: string, data: unknown): Promise<void> {
    const js = await this.getJsClient();
    await js.publish(subject, JSON.stringify(data));
  }

  /**
   * Get information about a JetStream stream.
   *
   * @param streamName - Stream name
   * @returns Stream information
   *
   * @example
   * ```typescript
   * const info = await tester.nats.getStreamInfo('WALLPAPER');
   * console.log(info.state.messages); // Number of messages in stream
   * ```
   */
  async getStreamInfo(streamName: string): Promise<StreamInfo> {
    const nc = await this.getConnection();
    const jsm = await nc.jetstreamManager();
    return jsm.streams.info(streamName);
  }

  /**
   * Purge all messages from a JetStream stream.
   * Useful for cleanup between tests.
   *
   * @param streamName - Stream name
   *
   * @example
   * ```typescript
   * await tester.nats.purgeStream('WALLPAPER');
   * ```
   */
  async purgeStream(streamName: string): Promise<void> {
    const nc = await this.getConnection();
    const jsm = await nc.jetstreamManager();
    await jsm.streams.purge(streamName);
  }

  /**
   * Purge all configured streams.
   * Useful for cleanup between tests.
   *
   * @example
   * ```typescript
   * await tester.nats.purgeAllStreams();
   * ```
   */
  async purgeAllStreams(): Promise<void> {
    for (const stream of this.config.streams) {
      await this.purgeStream(stream);
    }
  }

  /**
   * Close the NATS connection.
   * This is called automatically during the destroy phase.
   *
   * @example
   * ```typescript
   * await tester.nats.close();
   * ```
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
      this.jsClient = undefined;
    }
  }
}

export class NatsTesterBuilder extends BaseTesterBuilder<
  'nats',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
> {
  name = 'nats' as const;

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
    >,
  >(Base: TBase) {
    const desiredStreams: string[] = [];
    return class Nats extends Base {
      // Private: internal config storage
      _natsConfig: NatsConfig | undefined;

      // Public: helper instance
      readonly nats = new NatsHelpers(this);
      /**
       * Add a JetStream stream to be created during setup.
       * Can be called multiple times to create multiple streams.
       *
       * @param name - Stream name
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withNats(b => b.withJetstream())
       *       .withStream('WALLPAPER')
       *       .withStream('EVENTS');
       * ```
       */
      withStream(name: string) {
        desiredStreams.push(name);
        return this;
      }

      /**
       * Configure and start a NATS container.
       *
       * @param configure - Optional configuration callback
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withNats(b =>
       *   b.withJetstream()
       *    .withNetworkAlias('nats')
       * );
       * ```
       */
      withNats(configure: (nats: NatsBuilder) => NatsBuilder = (a) => a) {
        const options = configure(new NatsBuilder()).build();
        const { image = 'nats:2.10-alpine', jetStream = true, networkAlias = 'nats' } = options;

        this.addSetupHook(async () => {
          console.log('Starting NATS container...');

          // Auto-detect if network is available
          const dockerNetwork = this.docker.network;

          const containerOptions: NatsContainerOptions = {
            image,
            enableJetStream: jetStream,
          };

          if (dockerNetwork) {
            containerOptions.network = dockerNetwork;
            containerOptions.networkAliases = [networkAlias];
          }

          const started = await createNatsContainer(containerOptions);

          const host = dockerNetwork ? networkAlias : undefined;
          const port = dockerNetwork ? 4222 : undefined;

          // Internal endpoint: used for container-to-container communication
          const endpoint = started.getConnectionUrl(host, port);

          // External endpoint: used for host-to-container communication
          // Always uses mapped port accessible from host
          const externalEndpoint = started.getConnectionUrl();

          this._natsConfig = {
            container: started,
            endpoint: endpoint,
            externalEndpoint: externalEndpoint,
            options: options,
            streams: [],
          };

          // Create JetStream stream if specified
          if (jetStream && desiredStreams.length > 0) {
            // Wait a bit for NATS to fully initialize network interfaces
            // This is especially important when using Docker networks
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const nc = await connect({ servers: externalEndpoint, timeout: 30000 });
            const jsm = await nc.jetstreamManager();

            for (const stream of desiredStreams) {
              const streamConfig: Partial<StreamConfig> = {
                name: stream,
                subjects: [`${stream.toLowerCase()}.*`],
              };

              try {
                await jsm.streams.add(streamConfig);
                this._natsConfig?.streams.push(stream);
                console.log(`Created NATS stream: ${stream}`);
              } catch (error) {
                if (!(error as Error).message.includes('already exists')) {
                  throw error;
                }
              }
            }

            await nc.close();
          }

          console.log(`NATS started: ${endpoint} (internal), ${externalEndpoint} (external)`);
        });

        this.addDestroyHook(async () => {
          await this.nats.close(); // Close connection before stopping container
          if (this._natsConfig) {
            console.log('Stopping NATS container...');
            await this._natsConfig.container.stop();
          }
        });

        return this;
      }

      /**
       * Enable automatic cleanup of all streams in cleanup phase.
       * All messages are purged when tester.cleanup() is called.
       *
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withNats(b => b.withJetstream())
       *       .withStream('WALLPAPER')
       *       .withAutoCleanup();
       *
       * // In beforeEach:
       * await tester.cleanup(); // Purges all streams
       * ```
       */
      withNatsAutoCleanup() {
        this.addCleanupHook(async () => {
          await this.nats.purgeAllStreams();
        });
        return this;
      }

      /**
       * Get NATS configuration.
       * Backward compatibility method - prefer using tester.nats.config
       *
       * @returns NATS configuration object
       * @throws Error if NATS not initialized
       *
       * @example
       * ```typescript
       * const config = tester.getNats();
       * console.log(config.endpoint);
       * ```
       */
      getNats(): NatsConfig {
        return this.nats.config;
      }
    };
  }
}
