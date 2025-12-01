import { Client } from '@opensearch-project/opensearch';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

@singleton()
export class OpenSearchConnection {
  private client: Client | null = null;

  constructor(@inject('config') private config: Config) {}

  async connect(retries = 10, delay = 1000): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const isTest = process.env.NODE_ENV === 'test';
    this.client = new Client({
      node: this.config.opensearchUrl,
      // ssl: {
      //   rejectUnauthorized: !isTest, // Allow self-signed certs in tests
      // },
      ...(isTest && {
        auth: {
          username: this.config.opensearchUsername,
          password: this.config.opensearchPassword,
        },
      }),
    });

    // Test connection with retries
    for (let i = 0; i < 2; i++) {
      try {
        await this.client.ping();
        return this.client;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return this.client;
  }

  getClient(): Client {
    if (!this.client) {
      throw new Error('OpenSearch client not initialized. Call connect() first.');
    }
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const client = this.getClient();
      const info = client.info;
      await client.cluster.health();
      return info !== null;
    } catch (error) {
      console.error('OpenSearch health check failed:', error);
      return false;
    }
  }
}
