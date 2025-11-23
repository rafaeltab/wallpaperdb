import { describe, it, expect, beforeEach } from "vitest";
import { BaseConnection } from "../src/connections/base/base-connection.js";

interface TestConfig {
  url: string;
  timeout: number;
}

class TestConnection extends BaseConnection<string, TestConfig> {
  public createClientCalled = false;
  public closeClientCalled = false;
  public healthCheckResult = true;

  protected async createClient(): Promise<string> {
    this.createClientCalled = true;
    return `client-connected-to-${this.config.url}`;
  }

  protected async closeClient(_client: string): Promise<void> {
    this.closeClientCalled = true;
  }

  async checkHealth(): Promise<boolean> {
    return this.healthCheckResult;
  }
}

class FailingConnection extends BaseConnection<string, TestConfig> {
  protected async createClient(): Promise<string> {
    throw new Error("Connection failed");
  }

  protected async closeClient(_client: string): Promise<void> {
    // no-op
  }

  async checkHealth(): Promise<boolean> {
    return false;
  }
}

describe("BaseConnection", () => {
  let connection: TestConnection;
  const testConfig: TestConfig = { url: "localhost:5432", timeout: 5000 };

  beforeEach(() => {
    connection = new TestConnection(testConfig);
  });

  describe("initialize", () => {
    it("should create client on first initialize call", async () => {
      const client = await connection.initialize();

      expect(client).toBe("client-connected-to-localhost:5432");
      expect(connection.createClientCalled).toBe(true);
    });

    it("should return same client on subsequent initialize calls", async () => {
      const client1 = await connection.initialize();
      connection.createClientCalled = false; // reset flag

      const client2 = await connection.initialize();

      expect(client1).toBe(client2);
      expect(connection.createClientCalled).toBe(false); // should not create again
    });

    it("should propagate errors from createClient", async () => {
      const failingConnection = new FailingConnection(testConfig);

      await expect(failingConnection.initialize()).rejects.toThrow("Connection failed");
    });
  });

  describe("getClient", () => {
    it("should throw if not initialized", () => {
      expect(() => connection.getClient()).toThrow(
        "TestConnection not initialized. Call initialize() first."
      );
    });

    it("should return client after initialization", async () => {
      await connection.initialize();

      const client = connection.getClient();

      expect(client).toBe("client-connected-to-localhost:5432");
    });
  });

  describe("close", () => {
    it("should close client and reset state", async () => {
      await connection.initialize();
      expect(connection.isInitialized()).toBe(true);

      await connection.close();

      expect(connection.isInitialized()).toBe(false);
      expect(connection.closeClientCalled).toBe(true);
    });

    it("should be safe to call close when not initialized", async () => {
      await expect(connection.close()).resolves.not.toThrow();
      expect(connection.closeClientCalled).toBe(false);
    });

    it("should allow re-initialization after close", async () => {
      await connection.initialize();
      await connection.close();
      connection.createClientCalled = false;

      const client = await connection.initialize();

      expect(client).toBe("client-connected-to-localhost:5432");
      expect(connection.createClientCalled).toBe(true);
    });
  });

  describe("isInitialized", () => {
    it("should return false before initialization", () => {
      expect(connection.isInitialized()).toBe(false);
    });

    it("should return true after initialization", async () => {
      await connection.initialize();

      expect(connection.isInitialized()).toBe(true);
    });

    it("should return false after close", async () => {
      await connection.initialize();
      await connection.close();

      expect(connection.isInitialized()).toBe(false);
    });
  });

  describe("checkHealth", () => {
    it("should return health check result", async () => {
      await connection.initialize();

      expect(await connection.checkHealth()).toBe(true);

      connection.healthCheckResult = false;
      expect(await connection.checkHealth()).toBe(false);
    });
  });

  describe("config access", () => {
    it("should make config available to subclasses", async () => {
      const client = await connection.initialize();

      // The test connection uses config.url in createClient
      expect(client).toContain("localhost:5432");
    });
  });
});
