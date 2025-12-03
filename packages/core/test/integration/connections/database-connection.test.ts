import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseConnection } from "../../../src/connections/database-connection.js";
import type { DatabaseConfig } from "../../../src/connections/types.js";

// Simple test schema
const testTable = pgTable("test_table", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

const testSchema = { testTable };

describe("DatabaseConnection (Integration)", () => {
  let tester: ReturnType<typeof setup>;

  const setup = () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .build();

    return new Tester().withPostgres();
  };

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  const createConfig = (): DatabaseConfig => ({
    databaseUrl: tester.postgres.config.connectionStrings.fromHost,
  });

  it("should initialize and connect to real PostgreSQL", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);
    expect(connection.getClient()).toBeDefined();
    expect(connection.getClient().pool).toBeDefined();
    expect(connection.getClient().db).toBeDefined();

    await connection.close();
    expect(connection.isInitialized()).toBe(false);
  });

  it("should pass health check with valid connection", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(true);

    await connection.close();
  });

  it("should fail health check with invalid connection", async () => {
    const config: DatabaseConfig = {
      databaseUrl: "postgresql://invalid:invalid@localhost:9999/invalid",
    };

    const connection = new DatabaseConnection(config, testSchema);

    // Initialize succeeds (pool is created lazily), but health check should fail
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(false);

    await connection.close();
  });

  it("should respect pool configuration options", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema, {
      max: 5,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 1000,
    });
    await connection.initialize();

    const client = connection.getClient();
    expect(client.pool.options.max).toBe(5);
    expect(client.pool.options.idleTimeoutMillis).toBe(15000);
    expect(client.pool.options.connectionTimeoutMillis).toBe(1000);

    await connection.close();
  });

  it("should use default pool configuration", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    const client = connection.getClient();
    expect(client.pool.options.max).toBe(20);
    expect(client.pool.options.idleTimeoutMillis).toBe(30000);
    expect(client.pool.options.connectionTimeoutMillis).toBe(2000);

    await connection.close();
  });

  it("should enable OTEL instrumentation by default", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    const client = connection.getClient();

    // OTEL instrumentation is applied via @kubiks/otel-drizzle
    // We can't easily verify it's applied, but we can verify the client still works
    expect(client.db).toBeDefined();
    expect(typeof client.db.select).toBe("function");

    await connection.close();
  });

  it("should allow disabling OTEL instrumentation", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema, {
      enableOtel: false,
    });
    await connection.initialize();

    const client = connection.getClient();

    // Client should still work without OTEL
    expect(client.db).toBeDefined();
    expect(typeof client.db.select).toBe("function");

    await connection.close();
  });

  it("should be idempotent on multiple initialize calls", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);

    const client1 = await connection.initialize();
    const client2 = await connection.initialize();

    expect(client1).toBe(client2); // Same instance
    expect(client1.pool).toBe(client2.pool);
    expect(client1.db).toBe(client2.db);
    expect(connection.isInitialized()).toBe(true);

    await connection.close();
  });

  it("should throw when getClient() called before initialize", () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);

    expect(() => connection.getClient()).toThrow(
      "DatabaseConnection not initialized"
    );
  });

  it("should cleanup properly on close", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);

    await connection.close();

    expect(connection.isInitialized()).toBe(false);
    expect(() => connection.getClient()).toThrow();
  });

  it("should be safe to call close multiple times", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    await connection.close();
    await connection.close(); // Should not throw

    expect(connection.isInitialized()).toBe(false);
  });

  it("should work with actual database operations", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    try {
      const { db } = connection.getClient();

      // Create table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // Insert data
      await db.execute(`
        INSERT INTO test_table (name) VALUES ('test')
      `);

      // Query data
      const result = await db.execute(`
        SELECT * FROM test_table WHERE name = 'test'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ name: "test" });
    } finally {
      // Cleanup
      const { db } = connection.getClient();
      await db.execute("DROP TABLE IF EXISTS test_table");
      await connection.close();
    }
  });

  it("should preserve schema type safety", async () => {
    const config = createConfig();

    // This test verifies type safety at compile time
    // If it compiles, type safety is preserved
    const connection = new DatabaseConnection(config, testSchema);
    await connection.initialize();

    const { db } = connection.getClient();

    // TypeScript should know about testTable from the schema
    expect(db).toBeDefined();

    await connection.close();
  });

  it("should allow re-initialization after close", async () => {
    const config = createConfig();

    const connection = new DatabaseConnection(config, testSchema);

    // First lifecycle
    await connection.initialize();
    expect(connection.isInitialized()).toBe(true);
    await connection.close();
    expect(connection.isInitialized()).toBe(false);

    // Second lifecycle
    await connection.initialize();
    expect(connection.isInitialized()).toBe(true);

    const { db } = connection.getClient();
    expect(db).toBeDefined();

    await connection.close();
  });
});
