/** biome-ignore-all lint/style/noNonNullAssertion: :) */

import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import Docker from "dockerode";
import { describe, expect, it } from "vitest";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
} from "../src/index";

const docker = new Docker({
    // TODO figure out how to do this correctly, it doesn't work with the default.
    socketPath: "/home/rafaeltab/.docker/desktop/docker.sock",
});

describe(
    "MinioTesterBuilder",
    () => {
        it(
            "should create a container in the correct network",
            async () => {
                const Tester = createDefaultTesterBuilder()
                    .with(DockerTesterBuilder)
                    .with(MinioTesterBuilder)
                    .build();

                // Act
                const tester = await new Tester().withNetwork().withMinio().setup();
                const networkName = tester.docker.network?.getName();
                const containerId = tester.minio.config.container.getId();

                expect(networkName).not.toBeNull();
                expect(containerId).not.toBeNull();

                const containers = await docker.listContainers();
                const container = containers.find((x) => x.Id === containerId);

                // Assert
                expect(container).not.toBeNull();
                expect(
                    Object.keys(container?.NetworkSettings.Networks ?? {}),
                ).toContain(networkName);

                await tester.destroy();
            },
            { timeout: 120000 },
        );

        it("should create a bucket when requested", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            // Act
            const tester = await new Tester()
                .withMinio()
                .withMinioBucket("bananas")
                .setup();
            const config = tester.minio.config;

            expect(config).not.toBeNull();

            const endpoint = config.endpoint;

            const { accessKey, secretKey } = config.options;

            const s3Client = new S3Client({
                endpoint: endpoint,
                region: "us-east-1",
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey,
                },
                forcePathStyle: true,
            });

            const res = await s3Client.send(new ListBucketsCommand());

            expect(res.Buckets?.map((x) => x.Name)).toContain("bananas");

            await tester.destroy();
        });

        it("should create multiple buckets", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = await new Tester()
                .withMinio()
                .withMinioBucket("bucket1")
                .withMinioBucket("bucket2")
                .withMinioBucket("bucket3")
                .setup();

            const config = tester.minio.config;
            const s3Client = new S3Client({
                endpoint: config.endpoint,
                region: "us-east-1",
                credentials: {
                    accessKeyId: config.options.accessKey,
                    secretAccessKey: config.options.secretKey,
                },
                forcePathStyle: true,
            });

            const res = await s3Client.send(new ListBucketsCommand());
            const bucketNames = res.Buckets?.map((x) => x.Name) ?? [];

            expect(bucketNames).toContain("bucket1");
            expect(bucketNames).toContain("bucket2");
            expect(bucketNames).toContain("bucket3");

            await tester.destroy();
        });

        it("should use custom image when configured", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            // Use an actual existing MinIO image tag
            const customImage = "minio/minio:latest";
            const tester = await new Tester()
                .withMinio((builder) => builder.withImage(customImage))
                .setup();

            // Verify the configuration was applied
            expect(tester.minio.config.options.image).toBe(customImage);

            await tester.destroy();
        });

        it("should use custom credentials", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const customAccessKey = "mycustomaccesskey";
            const customSecretKey = "mycustomsecretkey123";

            const tester = await new Tester()
                .withMinio((builder) =>
                    builder.withAccessKey(customAccessKey).withSecretKey(customSecretKey),
                )
                .setup();

            const config = tester.minio.config;

            expect(config.options.accessKey).toBe(customAccessKey);
            expect(config.options.secretKey).toBe(customSecretKey);

            // Verify credentials work
            const s3Client = new S3Client({
                endpoint: config.endpoint,
                region: "us-east-1",
                credentials: {
                    accessKeyId: customAccessKey,
                    secretAccessKey: customSecretKey,
                },
                forcePathStyle: true,
            });

            const res = await s3Client.send(new ListBucketsCommand());
            expect(res.Buckets).toBeDefined();

            await tester.destroy();
        });

        it("should use custom network alias", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const customAlias = "my-minio-server";
            const tester = await new Tester()
                .withNetwork()
                .withMinio((builder) => builder.withNetworkAlias(customAlias))
                .setup();

            // Verify the configuration was applied
            expect(tester.minio.config.options.networkAlias).toBe(customAlias);

            // The network alias is only resolvable inside the Docker network
            // We can verify that MinIO started successfully and the config was set
            expect(tester.minio.config.container).toBeDefined();
            expect(tester.minio.config.endpoint).toContain(customAlias);

            await tester.destroy();
        });

        it(
            "should generate correct endpoint with network",
            async () => {
                const Tester = createDefaultTesterBuilder()
                    .with(DockerTesterBuilder)
                    .with(MinioTesterBuilder)
                    .build();

                const tester = await new Tester().withNetwork().withMinio().setup();

                const endpoint = tester.minio.config.endpoint;
                expect(endpoint).toBeDefined();
                expect(endpoint).toMatch(/^http:\/\/.+:9000$/);

                await tester.destroy();
            },
            { timeout: 120000 },
        );

        it("should generate correct endpoint without network", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = await new Tester().withMinio().setup();

            const endpoint = tester.minio.config.endpoint;
            expect(endpoint).toBeDefined();
            expect(endpoint).toMatch(/^http:\/\/.+:\d+$/);

            await tester.destroy();
        });

        it("should remove container on destroy", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = await new Tester().withMinio().setup();
            const containerId = tester.minio.config.container.getId();

            // Verify container exists
            const containersBefore = await docker.listContainers();
            expect(containersBefore.map((x) => x.Id)).toContain(containerId);

            await tester.destroy();

            // Verify container is removed
            const containersAfter = await docker.listContainers();
            expect(containersAfter.map((x) => x.Id)).not.toContain(containerId);
        });

        it("should have undefined minio before setup", () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = new Tester().withMinio();

            expect(() => tester.minio.config).toThrow("MinIO not initialized");
        });

        it("should allow S3 operations with configured credentials", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = await new Tester()
                .withMinio()
                .withMinioBucket("test-bucket")
                .setup();

            const config = tester.minio.config;
            const s3Client = new S3Client({
                endpoint: config.endpoint,
                region: "us-east-1",
                credentials: {
                    accessKeyId: config.options.accessKey,
                    secretAccessKey: config.options.secretKey,
                },
                forcePathStyle: true,
            });

            // Put an object
            const { PutObjectCommand, GetObjectCommand } = await import(
                "@aws-sdk/client-s3"
            );

            await s3Client.send(
                new PutObjectCommand({
                    Bucket: "test-bucket",
                    Key: "test-file.txt",
                    Body: "Hello, MinIO!",
                }),
            );

            // Get the object
            const getResult = await s3Client.send(
                new GetObjectCommand({
                    Bucket: "test-bucket",
                    Key: "test-file.txt",
                }),
            );

            const body = await getResult.Body?.transformToString();
            expect(body).toBe("Hello, MinIO!");

            await tester.destroy();
        });

        it("should handle bucket creation errors gracefully", async () => {
            const Tester = createDefaultTesterBuilder()
                .with(DockerTesterBuilder)
                .with(MinioTesterBuilder)
                .build();

            const tester = await new Tester()
                .withMinio()
                .withMinioBucket("test-bucket")
                .setup();

            const config = tester.minio.config;
            const s3Client = new S3Client({
                endpoint: config.endpoint,
                region: "us-east-1",
                credentials: {
                    accessKeyId: config.options.accessKey,
                    secretAccessKey: config.options.secretKey,
                },
                forcePathStyle: true,
            });

            // Try to create a bucket that already exists
            const { CreateBucketCommand } = await import("@aws-sdk/client-s3");

            await expect(
                s3Client.send(
                    new CreateBucketCommand({
                        Bucket: "test-bucket",
                    }),
                ),
            ).rejects.toThrow();

            await tester.destroy();
        });
    },
    { concurrent: true },
);
