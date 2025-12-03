import { HeadBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  type MinioConfig,
  MinioTesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MinioConnection } from "../../../src/connections/minio-connection.js";
import type { MinioConfig as CoreMinioConfig } from "../../../src/connections/types.js";

describe("MinioConnection (Integration)", () => {
  let tester: ReturnType<typeof setup>;

  const setup = () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(MinioTesterBuilder)
      .build();

    return new Tester().withMinio().withMinioBucket("test-bucket");
  };

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  const createConfig = (minioConfig: MinioConfig): CoreMinioConfig => ({
    s3Endpoint: minioConfig.endpoints.fromHost,
    s3Region: "us-east-1",
    s3AccessKeyId: minioConfig.options.accessKey,
    s3SecretAccessKey: minioConfig.options.secretKey,
    s3Bucket: "test-bucket",
  });

  it("should initialize and connect to real MinIO", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);
    expect(connection.getClient()).toBeDefined();

    await connection.close();
    expect(connection.isInitialized()).toBe(false);
  });

  it("should pass health check with existing bucket", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(true);

    await connection.close();
  });

  it("should fail health check with non-existent bucket", async () => {
    const config = createConfig(tester.minio.config);
    config.s3Bucket = "non-existent-bucket";

    const connection = new MinioConnection(config);
    await connection.initialize();

    const isHealthy = await connection.checkHealth();
    expect(isHealthy).toBe(false);

    await connection.close();
  });

  it("should enable forcePathStyle by default", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();

    const client = connection.getClient();

    // Verify client can communicate (forcePathStyle is required for MinIO)
    const result = await client.send(new HeadBucketCommand({ Bucket: "test-bucket" }));
    expect(result.$metadata.httpStatusCode).toBe(200);

    await connection.close();
  });

  it("should allow custom forcePathStyle option", async () => {
    const config = createConfig(tester.minio.config);

    // Test with explicit forcePathStyle: true
    const connection = new MinioConnection(config, { forcePathStyle: true });
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);

    await connection.close();
  });

  it("should be idempotent on multiple initialize calls", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);

    const client1 = await connection.initialize();
    const client2 = await connection.initialize();

    expect(client1).toBe(client2); // Same instance
    expect(connection.isInitialized()).toBe(true);

    await connection.close();
  });

  it("should throw when getClient() called before initialize", () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);

    expect(() => connection.getClient()).toThrow();
  });

  it("should cleanup properly on close", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();

    expect(connection.isInitialized()).toBe(true);

    await connection.close();

    expect(connection.isInitialized()).toBe(false);
    expect(() => connection.getClient()).toThrow();
  });

  it("should be safe to call close multiple times", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();

    await connection.close();
    await connection.close(); // Should not throw

    expect(connection.isInitialized()).toBe(false);
  });

  it("should work with actual S3 operations", async () => {
    const config = createConfig(tester.minio.config);

    const connection = new MinioConnection(config);
    await connection.initialize();
    try {
      const client = connection.getClient();

      // Upload an object
      await tester.minio.uploadObject("test-bucket", "test-file.txt", "Hello MinIO!");

      // Verify it exists via client
      const headResult = await client.send(
        new HeadObjectCommand({ Bucket: "test-bucket", Key: "test-file.txt" })
      );

      expect(headResult).not.toBeNull();
    } finally {
      // Cleanup
      await tester.minio.deleteObject("test-bucket", "test-file.txt");
      await connection.close();
    }
  });
});
