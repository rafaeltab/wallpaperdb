/**
 * Base class for all connection managers in WallpaperDB services.
 * Implements the singleton pattern and provides common lifecycle methods.
 *
 * @template TClient - The type of the client being managed
 * @template TConfig - The configuration type for this connection
 */
export abstract class BaseConnection<TClient, TConfig> {
  protected readonly config: TConfig;
  protected client: TClient | null = null;

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Creates a new client instance. Must be implemented by subclasses.
   * @returns A new client instance or a Promise that resolves to one
   */
  protected abstract createClient(): TClient | Promise<TClient>;

  /**
   * Closes the client connection. Must be implemented by subclasses.
   * @param client - The client to close
   */
  protected abstract closeClient(client: TClient): void | Promise<void>;

  /**
   * Performs a health check on the connection. Must be implemented by subclasses.
   * @returns A Promise that resolves to true if healthy, false otherwise
   */
  abstract checkHealth(): Promise<boolean>;

  /**
   * Gets the current client instance.
   * @throws {Error} If the connection has not been initialized
   * @returns The current client instance
   */
  getClient(): TClient {
    if (!this.client) {
      throw new Error(`${this.constructor.name} not initialized. Call initialize() first.`);
    }
    return this.client;
  }

  /**
   * Initializes the connection. Returns existing client if already initialized.
   * @returns The client instance
   */
  async initialize(): Promise<TClient> {
    if (this.client) {
      return this.client;
    }
    this.client = await this.createClient();
    return this.client;
  }

  /**
   * Closes the connection and resets the client instance.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.closeClient(this.client);
      this.client = null;
    }
  }

  /**
   * Checks if the connection is currently initialized.
   * @returns true if initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.client !== null;
  }
}
