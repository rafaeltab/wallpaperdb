import { type NatsConnection, connect } from 'nats';
import type { Config } from '../config.js';

let natsClient: NatsConnection | null = null;

export async function createNatsConnection(config: Config): Promise<NatsConnection> {
  if (natsClient) {
    return natsClient;
  }

  natsClient = await connect({
    servers: config.natsUrl,
    name: config.otelServiceName,
  });

  return natsClient;
}

export async function checkNatsHealth(): Promise<boolean> {
  if (!natsClient) {
    return false;
  }

  try {
    const info = natsClient.info;
    return info !== null && !natsClient.isClosed();
  } catch (error) {
    console.error('NATS health check failed:', error);
    return false;
  }
}

export function getNatsClient(): NatsConnection {
  if (!natsClient) {
    throw new Error('NATS client not initialized. Call createNatsConnection first.');
  }
  return natsClient;
}

export async function closeNatsConnection(): Promise<void> {
  if (natsClient) {
    await natsClient.close();
    natsClient = null;
  }
}
