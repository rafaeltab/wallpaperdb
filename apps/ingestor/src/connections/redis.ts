import Redis from "ioredis";
import { inject, singleton } from "tsyringe";
import type { Config } from "../config.js";
import { BaseConnection } from "./base/base-connection.js";

@singleton()
export class RedisConnection extends BaseConnection<Redis> {
    constructor(@inject("config") config: Config) {
        super(config);
    }

    public createClient(): Redis {
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

        return client;
    }

    protected async closeClient(client: Redis): Promise<void> {
        await client.quit();
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

