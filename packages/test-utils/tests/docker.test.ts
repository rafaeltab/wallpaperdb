import { describe, expect, it, afterEach } from "vitest";
import { createTesterBuilder, DockerTesterBuilder } from "../src/index";
import Docker from "dockerode";

const docker = new Docker({
    // TODO figure out how to do this correctly, it doesn't work with the default.
    socketPath: "/home/rafaeltab/.docker/desktop/docker.sock",
});

describe("DockerTesterBuilder", () => {
    it("should start a network when needed", async () => {
        const Tester = createTesterBuilder().with(DockerTesterBuilder).build();

        // Act
        const tester = await new Tester().withNetwork().setup();
        const networkName = tester.docker.network?.getName();
        const existingNetworks = await docker.listNetworks();

        // Assert
        expect(existingNetworks.map((x) => x.Name)).toContain(networkName);

        await tester.destroy();
    });

    it("should remove network on destroy", async () => {
        const Tester = createTesterBuilder().with(DockerTesterBuilder).build();

        // Setup
        const tester = await new Tester().withNetwork().setup();
        const networkName = tester.docker.network?.getName();

        // Verify network exists
        const networksBeforeDestroy = await docker.listNetworks();
        expect(networksBeforeDestroy.map((x) => x.Name)).toContain(networkName);

        // Destroy
        await tester.destroy();

        // Verify network is removed
        const networksAfterDestroy = await docker.listNetworks();
        expect(networksAfterDestroy.map((x) => x.Name)).not.toContain(networkName);
    });

    it("should have undefined network before setup", () => {
        const Tester = createTesterBuilder().with(DockerTesterBuilder).build();
        const tester = new Tester().withNetwork();

        expect(tester.docker.network).toBeUndefined();
    });

    it("should create isolated networks for multiple testers", async () => {
        const Tester = createTesterBuilder().with(DockerTesterBuilder).build();

        // Create two separate testers
        const tester1 = await new Tester().withNetwork().setup();
        const tester2 = await new Tester().withNetwork().setup();

        const network1Name = tester1.docker.network?.getName();
        const network2Name = tester2.docker.network?.getName();

        // Networks should be different
        expect(network1Name).not.toBe(network2Name);

        // Both should exist
        const existingNetworks = await docker.listNetworks();
        const networkNames = existingNetworks.map((x) => x.Name);
        expect(networkNames).toContain(network1Name);
        expect(networkNames).toContain(network2Name);

        // Cleanup
        await tester1.destroy();
        await tester2.destroy();
    });

    it("should handle setup without network", async () => {
        const Tester = createTesterBuilder().with(DockerTesterBuilder).build();

        // Setup without calling withNetwork()
        const tester = await new Tester().setup();

        // Network should be undefined
        expect(tester.docker.network).toBeUndefined();

        await tester.destroy();
    });
});
