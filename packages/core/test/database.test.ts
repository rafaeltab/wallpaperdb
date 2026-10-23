import pg from "pg";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createPool, checkPoolHealth } from "../src/connections/database.js";
import type { DatabaseConfig } from "../src/connections/types.js";

describe("Database Utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createPool", () => {
    it("should create a pool with default options", async () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@localhost:5432/test",
      };

      const pool = createPool(config);

      try {
        expect(pool.options).toMatchObject({
          connectionString: config.databaseUrl,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        });
      } finally {
        await pool.end();
      }
    });

    it("should accept custom pool options", async () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@localhost:5432/test",
      };

      const pool = createPool(config, {
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 1000,
      });

      try {
        expect(pool.options).toMatchObject({
          connectionString: config.databaseUrl,
          max: 5,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 1000,
        });
      } finally {
        await pool.end();
      }
    });
  });

  describe("checkPoolHealth", () => {
    it("should return false when pool cannot connect", async () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@database.invalid/test",
      };

      const pool = createPool(config);
      // Control the pg adapter input without replacing the health implementation.
      vi.spyOn(pool, "connect").mockImplementation(async () => {
        throw new Error("Connection refused");
      });

      try {
        expect(await checkPoolHealth(pool)).toBe(false);
      } finally {
        await pool.end();
      }
    });

    it("should return true after a successful health query and release the connection", async () => {
      const pool = createPool({ databaseUrl: "postgresql://test:test@database.invalid/test" });
      const client = Object.assign(new pg.Client(), { release: vi.fn() });
      const query = vi.spyOn(client, "query").mockImplementation(async () => ({
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ "?column?": 1 }],
      }));
      vi.spyOn(pool, "connect").mockImplementation(async () => client);

      try {
        expect(await checkPoolHealth(pool)).toBe(true);
        expect(query).toHaveBeenCalledWith("SELECT 1");
        expect(client.release).toHaveBeenCalledOnce();
      } finally {
        await pool.end();
      }
    });

    it("should return false when the health query fails", async () => {
      const pool = createPool({ databaseUrl: "postgresql://test:test@database.invalid/test" });
      const client = Object.assign(new pg.Client(), { release: vi.fn() });
      vi.spyOn(client, "query").mockImplementation(async () => {
        throw new Error("Query failed");
      });
      vi.spyOn(pool, "connect").mockImplementation(async () => client);

      try {
        expect(await checkPoolHealth(pool)).toBe(false);
      } finally {
        await pool.end();
      }
    });
  });
});
