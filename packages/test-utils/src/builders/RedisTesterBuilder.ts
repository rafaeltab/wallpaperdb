import {
    RedisContainer,
    type StartedRedisContainer,
} from "@testcontainers/redis";
import { type AddMethodsType, BaseTesterBuilder } from "../framework.js";
import type { DockerTesterBuilder } from "./DockerTesterBuilder.js";

export interface RedisOptions {
    image?: string;
    networkAlias?: string;
}

class RedisBuilder {
    private image = "redis:7-alpine";
    private networkAlias = "redis";

    withImage(image: string) {
        this.image = image;
        return this;
    }

    withNetworkAlias(alias: string) {
        this.networkAlias = alias;
        return this;
    }

    build(): RedisOptions {
        return {
            image: this.image,
            networkAlias: this.networkAlias,
        };
    }
}

export interface RedisConfig {
    container: StartedRedisContainer;
    endpoint: string;
    options: RedisOptions;
}

export class RedisTesterBuilder extends BaseTesterBuilder<
    "redis",
    [DockerTesterBuilder]
> {
    name = "redis" as const;

    addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
        return class Redis extends Base {
            redis: RedisConfig | undefined;
            withRedis(configure: (redis: RedisBuilder) => RedisBuilder = (a) => a) {
                const options = configure(new RedisBuilder()).build();
                const { image = "redis:7-alpine", networkAlias = "redis" } = options;

                this.addSetupHook(async () => {
                    console.log("Starting Redis container...");

                    // Auto-detect if network is available
                    const dockerNetwork = this.docker.network;

                    let container = new RedisContainer(image);

                    if (dockerNetwork) {
                        container = container
                            .withNetwork(dockerNetwork)
                            .withNetworkAliases(networkAlias);
                    }

                    const started = await container.start();

                    const host = dockerNetwork ? networkAlias : started.getHost();
                    const port = dockerNetwork ? 6379 : started.getPort();
                    const url = `redis://${host}:${port}`;

                    this.redis = {
                        container: started,
                        endpoint: url,
                        options: options,
                    };

                    console.log(`Redis started: ${url}`);
                });

                this.addDestroyHook(async () => {
                    if (this.redis) {
                        console.log("Stopping Redis container...");
                        await this.redis.container.stop();
                    }
                });

                return this;
            }

            getRedis() {
                if (!this.redis) {
                    throw new Error(
                        "Redis not initialized. Call withRedis() and setup() first.",
                    );
                }
                return this.redis;
            }
        };
    }
}
