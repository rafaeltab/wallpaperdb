import { describe, it, expect } from "vitest";
import { createPool, checkPoolHealth } from "../src/connections/database.js";
import type { DatabaseConfig } from "../src/connections/types.js";

describe("Database Utilities", () => {
  describe("createPool", () => {
    it("should create a pool with default options", () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@localhost:5432/test",
      };

      const pool = createPool(config);

      expect(pool).toBeDefined();
      // Pool is created but not connected - that's expected
      pool.end(); // Clean up
    });

    it("should accept custom pool options", () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@localhost:5432/test",
      };

      const pool = createPool(config, {
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 1000,
      });

      expect(pool).toBeDefined();
      pool.end(); // Clean up
    });
  });

  describe("checkPoolHealth", () => {
    it("should return false when pool cannot connect", async () => {
      const config: DatabaseConfig = {
        databaseUrl: "postgresql://test:test@localhost:59999/nonexistent",
      };

      const pool = createPool(config, {
        connectionTimeoutMillis: 100, // Fast timeout for test
      });

      const healthy = await checkPoolHealth(pool);

      expect(healthy).toBe(false);
      await pool.end();
    });
  });
});
