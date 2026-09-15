import { connect, type NatsConnection } from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    createNatsContainer,
    type StartedNatsContainer,
} from "../src/containers/nats.js";

// Readiness must hold when startup resolves; retries would conceal an early return.
const connectionOptions = {
    timeout: 5000,
    reconnect: false,
    waitOnFirstConnect: false,
};

describe("NATS Container", { timeout: 10000 }, () => {
    let container: StartedNatsContainer;
    let natsClient: NatsConnection;

    beforeAll(async () => {
        container = await createNatsContainer({
            enableJetStream: true,
        });

        // Startup may be slow on CI. Validate readiness, not elapsed startup time.
        natsClient = await connect({
            servers: container.getConnectionUrl(),
            ...connectionOptions,
        });
        const jsm = await natsClient.jetstreamManager({ timeout: 5000 });
        await jsm.getAccountInfo();
    }, 60000);

    afterAll(async () => {
        if (natsClient) {
            await natsClient.close();
        }
        if (container) {
            await container.stop();
        }
    });

    it("should return a valid connection URL", () => {
        const url = container.getConnectionUrl();

        expect(url).toBeDefined();
        expect(url).toMatch(/^nats:\/\/.+:\d+$/);

        // Parse URL to verify format
        const urlObj = new URL(url);
        expect(urlObj.protocol).toBe("nats:");
        expect(urlObj.hostname).toBeDefined();
        expect(urlObj.port).toBeDefined();
    });

    it("should be connected to NATS immediately after startup", () => {
        expect(natsClient).toBeDefined();
        expect(natsClient.isClosed()).toBe(false);

        // Verify server info
        const info = natsClient.info;
        expect(info).toBeDefined();
        expect(info?.version).toBeDefined();
    });

    it("should have JetStream enabled", async () => {
        expect(natsClient).toBeDefined();

        // Get JetStream manager
        const jsm = await natsClient.jetstreamManager();

        // Verify we can access JetStream
        const accountInfo = await jsm.getAccountInfo();
        expect(accountInfo).toBeDefined();
        expect(accountInfo.limits).toBeDefined();
    });

    it("should support basic pub/sub messaging", async () => {
        expect(natsClient).toBeDefined();

        const subject = "test.message";
        const testMessage = "Hello from NATS test!";

        // Create a promise that resolves when we receive the message
        const messagePromise = new Promise<string>((resolve) => {
            const sub = natsClient.subscribe(subject);
            (async () => {
                for await (const msg of sub) {
                    const decoded = new TextDecoder().decode(msg.data);
                    resolve(decoded);
                    sub.unsubscribe();
                    break;
                }
            })();
        });

        // Wait for the server to process the subscription before publishing.
        await natsClient.flush();

        // Publish message
        natsClient.publish(subject, new TextEncoder().encode(testMessage));

        // Wait for message
        const receivedMessage = await messagePromise;
        expect(receivedMessage).toBe(testMessage);
    });

    it("should support JetStream publish/subscribe", async () => {
        expect(natsClient).toBeDefined();

        const streamName = "TEST_STREAM";
        const subject = "test.jetstream.message";
        const testData = { id: "test-123", message: "JetStream test" };

        // Create JetStream manager and client
        const jsm = await natsClient.jetstreamManager();
        const js = natsClient.jetstream();

        // Create a stream
        await jsm.streams.add({
            name: streamName,
            subjects: ["test.jetstream.>"],
        });

        // Publish to JetStream
        const pubAck = await js.publish(subject, JSON.stringify(testData));
        expect(pubAck).toBeDefined();
        expect(pubAck.seq).toBeGreaterThan(0);

        // Create a consumer and verify we can read the message
        const consumer = await js.consumers.get(streamName);
        const messages = await consumer.consume({ max_messages: 1 });

        let receivedData: unknown = null;
        for await (const msg of messages) {
            receivedData = JSON.parse(new TextDecoder().decode(msg.data));
            msg.ack();
            break;
        }

        expect(receivedData).toEqual(testData);

        // Clean up
        await jsm.streams.delete(streamName);
    });

    it("should provide access to underlying container", () => {
        const underlyingContainer = container.getContainer();

        expect(underlyingContainer).toBeDefined();
        expect(underlyingContainer.getHost()).toBeDefined();
        expect(underlyingContainer.getMappedPort(4222)).toBeGreaterThan(0);
    });

    it("should stop cleanly", async () => {
        // This is tested in afterAll, but we can verify the container is running first
        const underlyingContainer = container.getContainer();
        expect(underlyingContainer).toBeDefined();

        // Container should be running at this point
        // We'll stop it in afterAll
    });
});

describe("NATS Container Configuration", () => {
    it("should reject a running server whose health check never becomes ready", async () => {
        let container: StartedNatsContainer | undefined;
        try {
            const start = async () => {
                container = await createNatsContainer({
                    // NATS still accepts connections on 4222, but the health check
                    // on 8222 must fail. An open port alone is not readiness.
                    additionalArgs: ["-m", "8223"],
                });
            };

            await expect(start()).rejects.toThrow(/Health check (failed|not healthy)/);
        } finally {
            await container?.stop();
        }
    }, 60000);

    it("should work with custom image", async () => {
        const container = await createNatsContainer({
            image: "nats:2.10-alpine",
            enableJetStream: true,
        });

        const url = container.getConnectionUrl();
        expect(url).toBeDefined();

        await container.stop();
    }, 60000);

    it("should work without JetStream", async () => {
        const container = await createNatsContainer({
            enableJetStream: false,
        });

        const url = container.getConnectionUrl();
        const client = await connect({ servers: url, ...connectionOptions });

        expect(client.isClosed()).toBe(false);

        await client.close();
        await container.stop();
    }, 60000);

    it("should work with additional args", async () => {
        const container = await createNatsContainer({
            enableJetStream: true,
            additionalArgs: ["-DV"], // Enable debug and trace
        });

        const url = container.getConnectionUrl();
        const client = await connect({ servers: url, ...connectionOptions });

        expect(client.isClosed()).toBe(false);

        await client.close();
        await container.stop();
    }, 60000);
});
