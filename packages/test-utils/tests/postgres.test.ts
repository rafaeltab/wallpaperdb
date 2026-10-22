import Docker from 'dockerode';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
} from '../src/index';

const docker = new Docker();

describe('PostgresTesterBuilder', { concurrent: true }, () => {
  it('should create a container', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    // Act
    const tester = new Tester().withPostgres();
    try {
      await tester.setup();
      const containerId = tester.postgres.config.container.getId();
      const existingContainers = await docker.listContainers();

      // Assert
      expect(existingContainers.map((x) => x.Id)).toContain(containerId);
    } finally {
      await tester.destroy();
    }
  });

  it('should create a container in the correct network', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    // Act
    const tester = new Tester().withNetwork().withPostgres();
    try {
      await tester.setup();
      const networkName = tester.docker.network?.getName();
      const containerId = tester.postgres.config.container.getId();

      expect(networkName).not.toBeNull();
      expect(containerId).not.toBeNull();

      const containers = await docker.listContainers();
      const container = containers.find((x) => x.Id === containerId);

      // Assert
      expect(container).not.toBeNull();
      expect(Object.keys(container?.NetworkSettings.Networks ?? {})).toContain(networkName);
    } finally {
      await tester.destroy();
    }
  });

  it('should create a fully ready postgres instance', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    // Act
    const tester = new Tester().withPostgres();
    try {
      await tester.setup();
      const connectionString = tester.postgres.config.connectionStrings.fromHost;

      expect(connectionString).not.toBeNull();

      const pool = new Pool({
        connectionString: connectionString,
        ssl: false,
      });
      try {
        const res = await pool.query(`SELECT schemaname, tablename
FROM pg_catalog.pg_tables
ORDER BY schemaname, tablename;`);

        // Assert
        expect(res.rowCount).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom image when configured', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const customImage = 'postgres:15-alpine';
    const tester = new Tester().withPostgres((builder) => builder.withImage(customImage));
    try {
      await tester.setup();

      const containerId = tester.postgres.config.container.getId();
      const containers = await docker.listContainers();
      const container = containers.find((x) => x.Id === containerId);

      expect(container?.Image).toContain('postgres:15');
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom database name', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const customDb = 'my_custom_database';
    const tester = new Tester().withPostgres((builder) => builder.withDatabase(customDb));
    try {
      await tester.setup();

      const pool = new Pool({
        connectionString: tester.postgres.config.connectionStrings.fromHost,
        ssl: false,
      });
      try {
        const res = await pool.query('SELECT current_database()');

        expect(res.rows[0].current_database).toBe(customDb);
      } finally {
        await pool.end();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom credentials', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const customUser = 'custom_user';
    const customPassword = 'custom_pass123';

    const tester = new Tester().withPostgres((builder) =>
      builder.withUser(customUser).withPassword(customPassword)
    );
    try {
      await tester.setup();

      const pool = new Pool({
        connectionString: tester.postgres.config.connectionStrings.fromHost,
        ssl: false,
      });
      try {
        const res = await pool.query('SELECT current_user');

        expect(res.rows[0].current_user).toBe(customUser);
      } finally {
        await pool.end();
      }
    } finally {
      await tester.destroy();
    }
  });

  it('should use custom network alias', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const customAlias = 'my-postgres-server';
    const tester = new Tester()
      .withNetwork()
      .withPostgres((builder) => builder.withNetworkAlias(customAlias));
    try {
      await tester.setup();

      const result = await tester.postgres.config.container.exec([
        'psql',
        tester.postgres.config.connectionStrings.networked,
        '--tuples-only',
        '--no-align',
        '-c',
        'SELECT 1',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('1');

      // Verify the configuration was applied
      expect(tester.postgres.config.options.networkAlias).toBe(customAlias);

      // The network alias is only resolvable inside the Docker network
      // We can verify that postgres started successfully and the config was set
      expect(tester.postgres.config.container).toBeDefined();
      expect(tester.postgres.config.connectionStrings.networked).toContain(customAlias);
    } finally {
      await tester.destroy();
    }
  });

  it('should generate correct connection string with network', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const tester = new Tester().withNetwork().withPostgres();
    try {
      await tester.setup();

      const connectionString = tester.postgres.config.connectionStrings.networked;
      expect(connectionString).toBeDefined();
      const result = await tester.postgres.config.container.exec([
        'psql',
        connectionString,
        '--tuples-only',
        '--no-align',
        '-c',
        'SELECT 1',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('1');
      expect(connectionString).toMatch(/^postgresql:\/\/.+:.+@.+:5432\/.+$/);
    } finally {
      await tester.destroy();
    }
  });

  it('should generate correct connection string without network', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const tester = new Tester().withPostgres();
    try {
      await tester.setup();

      const connectionString = tester.postgres.config.connectionStrings.fromHost;
      expect(connectionString).toBeDefined();
      expect(connectionString).toMatch(/^postgres(ql)?:\/\/.+:.+@.+:\d+\/.+$/);
    } finally {
      await tester.destroy();
    }
  });

  it('should remove container on destroy', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const tester = new Tester().withPostgres();
    let destroyed = false;
    try {
      await tester.setup();
      const containerId = tester.postgres.config.container.getId();

      // Verify container exists
      const containersBefore = await docker.listContainers();
      expect(containersBefore.map((x) => x.Id)).toContain(containerId);

      await tester.destroy();
      destroyed = true;

      // Verify container is removed
      const containersAfter = await docker.listContainers();
      expect(containersAfter.map((x) => x.Id)).not.toContain(containerId);
    } finally {
      if (!destroyed) await tester.destroy();
    }
  });

  it('should have undefined postgres before setup', () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const tester = new Tester().withPostgres();

    expect(() => tester.postgres.config).toThrow('PostgreSQL not initialized');
  });

  it('should allow multiple instances with different configs', async () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    const tester1 = new Tester().withPostgres((builder) => builder.withDatabase('db1'));
    try {
      await tester1.setup();
      const tester2 = new Tester().withPostgres((builder) => builder.withDatabase('db2'));
      try {
        await tester2.setup();

        // Both should have different connection strings
        expect(tester1.postgres.config.connectionStrings.fromHost).not.toBe(
          tester2.postgres.config.connectionStrings.fromHost
        );

        // Both should be functional
        const pool1 = new Pool({
          connectionString: tester1.postgres.config.connectionStrings.fromHost,
          ssl: false,
        });
        const pool2 = new Pool({
          connectionString: tester2.postgres.config.connectionStrings.fromHost,
          ssl: false,
        });

        try {
          const res1 = await pool1.query('SELECT current_database()');
          const res2 = await pool2.query('SELECT current_database()');

          expect(res1.rows[0].current_database).toBe('db1');
          expect(res2.rows[0].current_database).toBe('db2');
        } finally {
          await Promise.all([pool1.end(), pool2.end()]);
        }
      } finally {
        await tester2.destroy();
      }
    } finally {
      await tester1.destroy();
    }
  });
});
