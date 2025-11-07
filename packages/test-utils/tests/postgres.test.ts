import { describe, expect, it } from "vitest";
import {
    createTesterBuilder,
    DockerTesterBuilder,
    PostgresTesterBuilder,
} from "../src/index";
import Docker from "dockerode";
import { Pool } from "pg";

const docker = new Docker({
    // TODO figure out how to do this correctly, it doesn't work with the default.
    socketPath: "/home/rafaeltab/.docker/desktop/docker.sock",
});

describe("PostgresTesterBuilder", () => {
    it("should create a container", async () => {
        const Tester = createTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withPostgres().setup();
        const containerId = tester.postgres?.container.getId();
        const existingContainers = await docker.listContainers();

        // Assert
        expect(existingContainers.map((x) => x.Id)).toContain(containerId);
    });

    it("should create a container in the correct network", async () => {
        const Tester = createTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withNetwork().withPostgres().setup();
        const networkName = tester.docker.network?.getName();
        const containerId = tester.postgres?.container.getId();

        expect(networkName).not.toBeNull();
        expect(containerId).not.toBeNull();

        const containers = await docker.listContainers();
        const container = containers.find((x) => x.Id == containerId);

        // Assert
        expect(Object.keys(container!.NetworkSettings.Networks)).toContain(networkName);
    });

    it("should create a fully ready postgres instance", async () => {
        const Tester = createTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withPostgres().setup();
        const connectionString = tester.postgres?.connectionString;

        expect(connectionString).not.toBeNull();

        const pool = new Pool({
            connectionString: connectionString,
            ssl: false,
        });
        const client = await pool.connect();
        const res = await client.query(`SELECT schemaname, tablename
FROM pg_catalog.pg_tables
ORDER BY schemaname, tablename;`);

        // Assert
        expect(res.rowCount).toBeGreaterThan(0);
    });
});
