import { resolveUrlIpv4 } from '@wallpaperdb/url-ipv4-resolver';
import { connect, type NatsConnection } from 'nats';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { BaseConnection } from './base/base-connection.js';

@singleton()
export class NatsConnectionManager extends BaseConnection<NatsConnection, Config> {
  constructor(@inject('config') config: Config) {
    super(config);
  }

  protected async createClient(): Promise<NatsConnection> {
    const url = await resolveUrlIpv4(this.config.natsUrl);
    console.log(`Connecting to NATS at '${url}'`);

    const client = await connect({
      servers: url,
      name: this.config.otelServiceName,
    });

    console.log(`Connected to NATS`);
    return client;
  }

  protected async closeClient(client: NatsConnection): Promise<void> {
    await client.close();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const info = this.getClient().info;
      return info !== null && !this.getClient().isClosed();
    } catch (error) {
      console.error('NATS health check failed:', error);
      return false;
    }
  }
}
