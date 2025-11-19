import Redis from "ioredis";
import { inject, singleton } from "tsyringe";
import type { Config } from "../config.js";
import { BaseConnection } from "./base/base-connection.js";

@singleton()
export class RedisConnection extends BaseConnection<Redis> {
    constructor(@inject("config") config: Config) {
        super(config);
    }

    public async createClient(): Promise<Redis> {
        if (!this.config.redisEnabled) {
            throw new Error("Redis is not enabled");
        }

        const client = new Redis({
            host: this.config.redisHost,
            port: this.config.redisPort,
            password: this.config.redisPassword,
            maxRetriesPerRequest: 3,
            enableOfflineQueue: false, // Fail fast if Redis unavailable
            retryStrategy: (times) => {
                if (times > 3) {
                    return null; // Stop retrying after 3 attempts
                }
                return Math.min(times * 100, 2000); // Exponential backoff (max 2s)
            },
            lazyConnect: true, // Don't connect until explicitly called
        });

        client.on("error", (err) => {
            console.error("Redis connection error:", err);
        });

        client.on("connect", () => {
            console.log("Redis connected successfully");
        });

        client.on("close", () => {
            console.log("Redis connection closed");
        });

        // Explicitly connect since we use lazyConnect: true
        await client.connect();

        return client;
    }

    protected async closeClient(client: Redis): Promise<void> {
        // Check if client is in a state where it can be closed
        if (client.status === "end" || client.status === "close") {
            return; // Already closed
        }

        try {
            // Only quit if connected or ready
            if (client.status === "ready" || client.status === "connecting") {
                await client.quit();
            } else {
                // Force disconnect for other states
                client.disconnect();
            }
        } catch (error) {
            // If quit fails, force disconnect
            console.warn("Redis quit failed, forcing disconnect:", error);
            client.disconnect();
        }
    }

    async checkHealth(): Promise<boolean> {
        try {
            await this.getClient().ping();
            return true;
        } catch (error) {
            console.error("Redis health check failed:", error);
            return false;
        }
    }
}

