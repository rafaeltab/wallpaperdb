import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

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
}

/**
 * Started NATS container with helper methods
 */
export class StartedNatsContainer {
  constructor(private readonly container: StartedTestContainer) {}

  /**
   * Get the NATS connection URL
   * @returns NATS connection URL in format: nats://host:port
   */
  getConnectionUrl(): string {
    const host = this.container.getHost();
    const port = this.container.getMappedPort(4222);
    return `nats://${host}:${port}`;
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
  } = options;

  // Build command arguments
  const command: string[] = [];
  if (enableJetStream) {
    command.push('-js');
  }
  command.push(...additionalArgs);

  // Create and start the container with wait strategy
  const container = await new GenericContainer(image)
    .withExposedPorts(4222)
    .withCommand(command)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();

  return new StartedNatsContainer(container);
}
