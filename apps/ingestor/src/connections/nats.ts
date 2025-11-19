import { type NatsConnection, connect } from "nats";
import { singleton } from "tsyringe";
import type { Config } from "../config.js";
import { BaseConnection } from "./base/base-connection.js";

@singleton()
export class NatsConnectionManager extends BaseConnection<NatsConnection> {
    protected async createClient(config: Config): Promise<NatsConnection> {
        const client = await connect({
            servers: config.natsUrl,
            name: config.otelServiceName,
        });

        console.log(`Connected to NATS at '${config.natsUrl}'`);
        return client;
    }

    protected async closeClient(client: NatsConnection): Promise<void> {
        await client.close();
    }

    async checkHealth(client: NatsConnection, _config: Config): Promise<boolean> {
        try {
            const info = client.info;
            return info !== null && !client.isClosed();
        } catch (error) {
            console.error("NATS health check failed:", error);
            return false;
        }
    }
}

// Singleton instance
const natsConnectionManager = new NatsConnectionManager();

// Legacy API for backward compatibility
export async function createNatsConnection(
    config: Config,
): Promise<NatsConnection> {
    return await natsConnectionManager.initialize(config);
}

export async function checkNatsHealth(): Promise<boolean> {
    if (!natsConnectionManager.isInitialized()) {
        return false;
    }
    // Pass empty config since health check doesn't use it
    return await natsConnectionManager.checkHealth(
        natsConnectionManager.getClient(),
        {} as Config,
    );
}

export function getNatsClient(): NatsConnection {
    return natsConnectionManager.getClient();
}

export async function closeNatsConnection(): Promise<void> {
    await natsConnectionManager.close();
}

// Export the connection instance for DI usage
export { natsConnectionManager };
