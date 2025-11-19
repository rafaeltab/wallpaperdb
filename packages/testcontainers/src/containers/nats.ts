import {
  GenericContainer,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

/**
 * Configuration options for NATS container
 */
export interface NatsContainerOptions {
  /**
   * Docker image to use for NATS
   * @default 'nats:2.10-alpine'
   */
  image?: string;

  /**
   * Enable JetStream support
   * @default true
   */
  enableJetStream?: boolean;

  /**
   * Additional command-line arguments to pass to NATS server
   */
  additionalArgs?: string[];

  /**
   * Docker network to connect the container to
   */
  network?: StartedNetwork;

  /**
   * Network aliases for the container
   */
  networkAliases?: string[];
}

/**
 * Started NATS container with helper methods
 */
export class StartedNatsContainer {
  constructor(private readonly container: StartedTestContainer) {}

  /**
   * Get the NATS connection URL
   * @returns NATS connection URL in format: nats://host:port
   * @note Uses 127.0.0.1 instead of localhost to avoid DNS resolution delays
   */
  getConnectionUrl(host?: string, port?: number): string {
    host ??= this.getHost();
    port ??= this.container.getMappedPort(4222);
    return `nats://${host}:${port}`;
  }

  getHost(): string {
    let host = this.container.getHost();
    // Replace localhost with 127.0.0.1 to avoid DNS resolution delays
    if (host === 'localhost') {
      host = '127.0.0.1';
    }
    return host;
  }

  getPort(): number {
    return this.container.getMappedPort(4222);
  }

  /**
   * Get the underlying test container
   */
  getContainer(): StartedTestContainer {
    return this.container;
  }

  /**
   * Stop the NATS container
   */
  async stop(): Promise<void> {
    await this.container.stop();
  }
}

/**
 * Create and start a NATS testcontainer with JetStream support
 *
 * This function creates a NATS container with proper wait strategy to ensure
 * the server is ready before tests begin, eliminating connection delays.
 *
 * @param options Configuration options for the NATS container
 * @returns Promise resolving to a started NATS container
 *
 * @example
 * ```typescript
 * const natsContainer = await createNatsContainer({
 *   enableJetStream: true
 * });
 *
 * const connectionUrl = natsContainer.getConnectionUrl();
 * // Use connectionUrl to connect your NATS client
 *
 * // Clean up when done
 * await natsContainer.stop();
 * ```
 */
export async function createNatsContainer(
  options: NatsContainerOptions = {}
): Promise<StartedNatsContainer> {
  const {
    image = 'nats:2.10-alpine',
    enableJetStream = true,
    additionalArgs = [],
    network,
    networkAliases = [],
  } = options;

  // Build command arguments
  const command: string[] = ['-m', '8222'];
  if (enableJetStream) {
    command.push('-js');
  }
  command.push(...additionalArgs);

  const healthInterval = 200;
  const totalDuration = 10000;
  const retries = totalDuration / healthInterval;

  // Create container builder
  let containerBuilder = new GenericContainer(image)
    .withExposedPorts(4222)
    .withCommand(command)
    .withHealthCheck({
      test: ['CMD', 'wget', 'http://localhost:8222/healthz', '-q', '-S'],
      interval: 200,
      retries: retries,
      startPeriod: 1000,
      timeout: 1000,
    })
    .withWaitStrategy(Wait.forHealthCheck());
  // .withWaitStrategy(Wait.forLogMessage('Server is ready').withStartupTimeout(60000));

  // Add network if specified
  if (network) {
    containerBuilder = containerBuilder.withNetwork(network);
  }

  // Add network aliases if specified
  for (const alias of networkAliases) {
    containerBuilder = containerBuilder.withNetworkAliases(alias);
  }

  // Start the container
  const container = await containerBuilder.start();

  return new StartedNatsContainer(container);
}
