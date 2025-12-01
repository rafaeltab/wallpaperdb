import { singleton, inject } from 'tsyringe';
import { connect, type NatsConnection } from 'nats';
import type { Config } from '../config.js';

/**
 * NATS connection manager
 */
@singleton()
export class NatsConnectionManager {
  private connection: NatsConnection | null = null;

  constructor(@inject('config') private readonly config: Config) {}

  /**
   * Connect to NATS server
   */
  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    this.connection = await connect({
      servers: this.config.natsUrl,
    });
  }

  /**
   * Get the NATS connection
   */
  getConnection(): NatsConnection {
    if (!this.connection) {
      throw new Error('NATS connection not initialized');
    }
    return this.connection;
  }

  /**
   * Disconnect from NATS
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const info = this.getConnection().info;
      return info !== null && !this.getConnection().isClosed();
    } catch (error) {
      console.error('NATS health check failed:', error);
      return false;
    }
  }
}
