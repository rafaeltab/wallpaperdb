import { HeadBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  type S3Config,
  S3TesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Connection } from "../../../src/connections/s3-connection.js";
import type { S3Config as CoreS3Config } from "../../../src/connections/types.js";

describe("S3Connection (Integration)", () => {
  let tester: ReturnType<typeof setup>;

  const setup = () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(S3TesterBuilder)
      .build();

    return new Tester().withS3().withS3Bucket("test-bucket");
  };

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  const createConfig = (s3Config: S3Config): CoreS3Config => ({
    s3Endpoint: s3Config.endpoints.fromHost,
    s3Region: "us-east-1",
    s3AccessKeyId: s3Config.options.accessKey,
    s3SecretAccessKey: s3Config.options.secretKey,
    s3Bucket: "test-bucket",
  });

  it("should initialize and connect to SeaweedFS through S3", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);
    expect(connection.getClient()).toBeDefined();

    await connection.close();
    expect(connection.isInitialized()).toBe(false);
  });

  it("should pass health check with existing bucket", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(true);

    await connection.close();
  });

  it("should fail health check with non-existent bucket", async () => {
    const config = createConfig(tester.s3.config);
    config.s3Bucket = "non-existent-bucket";

    const connection = new S3Connection(config);
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(false);

    await connection.close();
  });

  it("should enable forcePathStyle by default", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();

    const client = connection.getClient();

    // Verify client can communicate using the path-style URLs required by local storage.
    const result = await client.send(new HeadBucketCommand({ Bucket: "test-bucket" }));
    expect(result.$metadata.httpStatusCode).toBe(200);

    await connection.close();
  });

  it("should allow custom forcePathStyle option", async () => {
    const config = createConfig(tester.s3.config);

    // Test with explicit forcePathStyle: true
    const connection = new S3Connection(config, { forcePathStyle: true });
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);

    await connection.close();
  });

  it("should be idempotent on multiple initialize calls", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);

    const client1 = await connection.initialize();
    const client2 = await connection.initialize();

    expect(client1).toBe(client2); // Same instance
    expect(connection.isInitialized()).toBe(true);

    await connection.close();
  });

  it("should throw when getClient() called before initialize", () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);

    expect(() => connection.getClient()).toThrow();
  });

  it("should cleanup properly on close", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);

    await connection.close();

    expect(connection.isInitialized()).toBe(false);
    expect(() => connection.getClient()).toThrow();
  });

  it("should be safe to call close multiple times", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();

    await connection.close();
    await connection.close(); // Should not throw

    expect(connection.isInitialized()).toBe(false);
  });

  it("should work with actual S3 operations", async () => {
    const config = createConfig(tester.s3.config);

    const connection = new S3Connection(config);
    await connection.initialize();
    try {
      const client = connection.getClient();

      // Upload an object
      await tester.s3.uploadObject("test-bucket", "test-file.txt", "Hello S3!");

      // Verify it exists via client
      const headResult = await client.send(
        new HeadObjectCommand({ Bucket: "test-bucket", Key: "test-file.txt" })
      );

      expect(headResult).not.toBeNull();
    } finally {
      // Cleanup
      await tester.s3.deleteObject("test-bucket", "test-file.txt");
      await connection.close();
    }
  });
});
