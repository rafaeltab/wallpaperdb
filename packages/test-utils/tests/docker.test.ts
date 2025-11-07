import { describe, expect, it } from "vitest";
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
    });

});
