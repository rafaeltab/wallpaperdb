import Docker from "dockerode";
import { createClient, type RedisClientType } from "redis";
import { describe, expect, it } from "vitest";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    RedisTesterBuilder,
} from "../src/index";

const IS_GITHUB = process.env.GITHUB_ACTIONS === "true";

const docker = new Docker({
    // TODO figure out how to do this correctly, it doesn't work with the default.
    socketPath: IS_GITHUB
        ? undefined
        : "/home/rafaeltab/.docker/desktop/docker.sock",
});

describe(
    "RedisTesterBuilder",
    () => {
        it("should create a container", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();
            const containerId = tester.redis.config.container.getId();
            const existingContainers = await docker.listContainers();

            expect(existingContainers.map((x) => x.Id)).toContain(containerId);

            await tester.destroy();
        });

        it.skip("should create a container in the correct network", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withNetwork().withRedis().setup();
            const networkName = tester.docker.network?.getName();
            const containerId = tester.redis.config.container.getId();

            expect(networkName).not.toBeNull();
            expect(containerId).not.toBeNull();

            const containers = await docker.listContainers();
            const container = containers.find((x) => x.Id === containerId);

            expect(container).not.toBeNull();
            expect(Object.keys(container?.NetworkSettings.Networks ?? {})).toContain(
                networkName,
            );

            await tester.destroy();
        });

        it("should create a fully ready Redis instance", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();
            const endpoint = tester.redis.config.endpoints.fromHost;

            expect(endpoint).not.toBeNull();

            // Connect and verify Redis is accessible
            const client: RedisClientType = createClient({ url: endpoint });
            await client.connect();

            expect(client.isReady).toBe(true);

            await client.quit();
            await tester.destroy();
        });

        it("should use custom image when configured", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const customImage = "redis:7-alpine";
            const tester = await new Tester()
                .withRedis((builder) => builder.withImage(customImage))
                .setup();

            expect(tester.redis.config.options.image).toBe(customImage);

            await tester.destroy();
        });

        it("should allow basic Redis operations (SET/GET)", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            const client: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });
            await client.connect();

            // Set a value
            await client.set("test-key", "test-value");

            // Get the value
            const value = await client.get("test-key");
            expect(value).toBe("test-value");

            await client.quit();
            await tester.destroy();
        });

        it("should support complex data types (hashes)", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            const client: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });
            await client.connect();

            // Set hash values
            await client.hSet("user:1", {
                name: "John Doe",
                email: "john@example.com",
                age: "30",
            });

            // Get hash values
            const user = await client.hGetAll("user:1");
            expect(user.name).toBe("John Doe");
            expect(user.email).toBe("john@example.com");
            expect(user.age).toBe("30");

            await client.quit();
            await tester.destroy();
        });

        it("should support lists", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            const client: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });
            await client.connect();

            // Push to list
            await client.rPush("my-list", ["item1", "item2", "item3"]);

            // Get list length
            const length = await client.lLen("my-list");
            expect(length).toBe(3);

            // Get all items
            const items = await client.lRange("my-list", 0, -1);
            expect(items).toEqual(["item1", "item2", "item3"]);

            await client.quit();
            await tester.destroy();
        });

        it("should support key expiration", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            const client: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });
            await client.connect();

            // Set a key with expiration
            await client.set("expiring-key", "value", { EX: 1 }); // 1 second expiration

            // Verify it exists
            const value1 = await client.get("expiring-key");
            expect(value1).toBe("value");

            // Wait for expiration
            await new Promise((resolve) => setTimeout(resolve, 1100));

            // Verify it's gone
            const value2 = await client.get("expiring-key");
            expect(value2).toBeNull();

            await client.quit();
            await tester.destroy();
        });

        it("should support pub/sub", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            // Create publisher and subscriber clients
            const publisher: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });
            const subscriber: RedisClientType = createClient({
                url: tester.redis.config.endpoints.fromHost,
            });

            await publisher.connect();
            await subscriber.connect();

            // Track received messages
            const messages: string[] = [];

            // Subscribe to channel
            await subscriber.subscribe("test-channel", (message) => {
                messages.push(message);
            });

            // Publish messages
            await publisher.publish("test-channel", "message1");
            await publisher.publish("test-channel", "message2");
            await publisher.publish("test-channel", "message3");

            // Wait for messages to be received
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(messages).toEqual(["message1", "message2", "message3"]);

            await subscriber.quit();
            await publisher.quit();
            await tester.destroy();
        });

        it.skip("should use custom network alias", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const customAlias = "my-redis-server";
            const tester = await new Tester()
                .withNetwork()
                .withRedis((builder) => builder.withNetworkAlias(customAlias))
                .setup();

            expect(tester.redis.config.options.networkAlias).toBe(customAlias);
            expect(tester.redis.config.container).toBeDefined();

            await tester.destroy();
        });

        it("should generate correct endpoint format", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            const endpoint = tester.redis.config.endpoints.fromHost;
            expect(endpoint).toBeDefined();
            expect(endpoint).toMatch(/^redis:\/\/.+:\d+$/);

            await tester.destroy();
        });

        it("should remove container on destroy", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();
            const containerId = tester.redis.config.container.getId();

            // Verify container exists
            const containersBefore = await docker.listContainers();
            expect(containersBefore.map((x) => x.Id)).toContain(containerId);

            await tester.destroy();

            // Verify container is removed
            const containersAfter = await docker.listContainers();
            expect(containersAfter.map((x) => x.Id)).not.toContain(containerId);
        });

        it("should throw error when accessing config before setup", () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = new Tester().withRedis();

            expect(() => tester.redis.config).toThrow("Redis not initialized");
        });

        it("should handle connection errors gracefully", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(RedisTesterBuilder)
                .build();

            const tester = await new Tester().withRedis().setup();

            // Create client with wrong URL
            const client: RedisClientType = createClient({
                url: "redis://invalid-host:6379",
                socket: {
                    connectTimeout: 1000,
                },
            });

            await expect(client.connect()).rejects.toThrow();

            await tester.destroy();
        });
    },
    { concurrent: true },
);
