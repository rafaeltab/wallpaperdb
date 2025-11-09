import { describe, expect, it } from "vitest";
import {
    createDefaultTesterBuilder,
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
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withPostgres().setup();
        const containerId = tester.postgres.config.container.getId();
        const existingContainers = await docker.listContainers();

        // Assert
        expect(existingContainers.map((x) => x.Id)).toContain(containerId);
    });

    it("should create a container in the correct network", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withNetwork().withPostgres().setup();
        const networkName = tester.docker.network?.getName();
        const containerId = tester.postgres.config.container.getId();

        expect(networkName).not.toBeNull();
        expect(containerId).not.toBeNull();

        const containers = await docker.listContainers();
        const container = containers.find((x) => x.Id == containerId);

        // Assert
        expect(Object.keys(container!.NetworkSettings.Networks)).toContain(networkName);
    });

    it("should create a fully ready postgres instance", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        // Act
        const tester = await new Tester().withPostgres().setup();
        const connectionString = tester.postgres.config.connectionString;

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

        await client.release();
        await pool.end();
        await tester.destroy();
    });

    it("should use custom image when configured", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const customImage = "postgres:15-alpine";
        const tester = await new Tester()
            .withPostgres((builder) => builder.withImage(customImage))
            .setup();

        const containerId = tester.postgres.config.container.getId();
        const containers = await docker.listContainers();
        const container = containers.find((x) => x.Id === containerId);

        expect(container?.Image).toContain("postgres:15");

        await tester.destroy();
    });

    it("should use custom database name", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const customDb = "my_custom_database";
        const tester = await new Tester()
            .withPostgres((builder) => builder.withDatabase(customDb))
            .setup();

        const pool = new Pool({
            connectionString: tester.postgres.config.connectionString,
            ssl: false,
        });
        const client = await pool.connect();
        const res = await client.query("SELECT current_database()");

        expect(res.rows[0].current_database).toBe(customDb);

        await client.release();
        await pool.end();
        await tester.destroy();
    });

    it("should use custom credentials", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const customUser = "custom_user";
        const customPassword = "custom_pass123";

        const tester = await new Tester()
            .withPostgres((builder) =>
                builder.withUser(customUser).withPassword(customPassword)
            )
            .setup();

        const pool = new Pool({
            connectionString: tester.postgres.config.connectionString,
            ssl: false,
        });
        const client = await pool.connect();
        const res = await client.query("SELECT current_user");

        expect(res.rows[0].current_user).toBe(customUser);

        await client.release();
        await pool.end();
        await tester.destroy();
    });

    it("should use custom network alias", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const customAlias = "my-postgres-server";
        const tester = await new Tester()
            .withNetwork()
            .withPostgres((builder) => builder.withNetworkAlias(customAlias))
            .setup();

        // Verify the configuration was applied
        expect(tester.postgres.config.options.networkAlias).toBe(customAlias);

        // The network alias is only resolvable inside the Docker network
        // We can verify that postgres started successfully and the config was set
        expect(tester.postgres.config.container).toBeDefined();
        expect(tester.postgres.config.connectionString).toContain(customAlias);

        await tester.destroy();
    });

    it("should generate correct connection string with network", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester = await new Tester().withNetwork().withPostgres().setup();

        const connectionString = tester.postgres.config.connectionString;
        expect(connectionString).toBeDefined();
        expect(connectionString).toMatch(/^postgresql:\/\/.+:.+@.+:5432\/.+$/);

        await tester.destroy();
    });

    it("should generate correct connection string without network", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester = await new Tester().withPostgres().setup();

        const connectionString = tester.postgres.config.connectionString;
        expect(connectionString).toBeDefined();
        expect(connectionString).toMatch(/^postgres(ql)?:\/\/.+:.+@.+:\d+\/.+$/);

        await tester.destroy();
    });

    it("should provide correct host and port", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester = await new Tester().withPostgres().setup();

        expect(tester.postgres.config.host).toBeDefined();
        expect(tester.postgres.config.port).toBeDefined();
        expect(typeof tester.postgres.config.host).toBe("string");
        expect(typeof tester.postgres.config.port).toBe("number");

        await tester.destroy();
    });

    it("should remove container on destroy", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester = await new Tester().withPostgres().setup();
        const containerId = tester.postgres.config.container.getId();

        // Verify container exists
        const containersBefore = await docker.listContainers();
        expect(containersBefore.map((x) => x.Id)).toContain(containerId);

        await tester.destroy();

        // Verify container is removed
        const containersAfter = await docker.listContainers();
        expect(containersAfter.map((x) => x.Id)).not.toContain(containerId);
    });

    it("should have undefined postgres before setup", () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester = new Tester().withPostgres();

        expect(() => tester.postgres.config).toThrow('PostgreSQL not initialized');
    });

    it("should allow multiple instances with different configs", async () => {
        const Tester = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .build();

        const tester1 = await new Tester()
            .withPostgres((builder) => builder.withDatabase("db1"))
            .setup();
        const tester2 = await new Tester()
            .withPostgres((builder) => builder.withDatabase("db2"))
            .setup();

        // Both should have different connection strings
        expect(tester1.postgres.config.connectionString).not.toBe(
            tester2.postgres.config.connectionString
        );

        // Both should be functional
        const pool1 = new Pool({
            connectionString: tester1.postgres.config.connectionString,
            ssl: false,
        });
        const pool2 = new Pool({
            connectionString: tester2.postgres.config.connectionString,
            ssl: false,
        });

        const client1 = await pool1.connect();
        const client2 = await pool2.connect();

        const res1 = await client1.query("SELECT current_database()");
        const res2 = await client2.query("SELECT current_database()");

        expect(res1.rows[0].current_database).toBe("db1");
        expect(res2.rows[0].current_database).toBe("db2");

        await client1.release();
        await client2.release();
        await pool1.end();
        await pool2.end();
        await tester1.destroy();
        await tester2.destroy();
    });
});
