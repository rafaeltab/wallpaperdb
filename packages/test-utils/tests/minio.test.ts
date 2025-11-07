/** biome-ignore-all lint/style/noNonNullAssertion: :) */

import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import Docker from "dockerode";
import { describe, expect, it } from "vitest";
import {
	createTesterBuilder,
	DockerTesterBuilder,
	MinioTesterBuilder,
} from "../src/index";

const docker = new Docker({
	// TODO figure out how to do this correctly, it doesn't work with the default.
	socketPath: "/home/rafaeltab/.docker/desktop/docker.sock",
});

describe("MinioTesterBuilder", () => {
	it("should create a container", async () => {
		const Tester = createTesterBuilder()
			.with(DockerTesterBuilder)
			.with(MinioTesterBuilder)
			.build();

		// Act
		const tester = await new Tester().withNetwork().withMinio().setup();
		const containerId = tester.minio?.container.getId();
		const existingContainers = await docker.listContainers();

		// Assert
		expect(existingContainers.map((x) => x.Id)).toContain(containerId);
	});

	it("should create a container in the correct network", async () => {
		const Tester = createTesterBuilder()
			.with(DockerTesterBuilder)
			.with(MinioTesterBuilder)
			.build();

		// Act
		const tester = await new Tester().withNetwork().withMinio().setup();
		const networkName = tester.docker.network?.getName();
		const containerId = tester.minio?.container.getId();

		expect(networkName).not.toBeNull();
		expect(containerId).not.toBeNull();

		const containers = await docker.listContainers();
		const container = containers.find((x) => x.Id === containerId);

		// Assert
		expect(container).not.toBeNull();
		expect(Object.keys(container?.NetworkSettings.Networks ?? {})).toContain(
			networkName,
		);
	});

	it("should create a bucket when requested", async () => {
		const Tester = createTesterBuilder()
			.with(DockerTesterBuilder)
			.with(MinioTesterBuilder)
			.build();

		// Act
		const tester = await new Tester()
			.withMinio()
			.withMinioBucket("bananas")
			.setup();
		const config = tester.minio;

		expect(config).not.toBeNull();

		const endpoint = config!.endpoint;

		const { accessKey, secretKey } = config!.options;

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
	});
});
