import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStorageEnvironment } from "./env-pipeline.mjs";

test("legacy storage credentials and port survive environment generation", () => {
	const environment = Object.freeze({
		MINIO_ROOT_USER: "custom-storage-user",
		MINIO_ROOT_PASSWORD: "custom-storage-secret",
		MINIO_API_HOST_PORT: "8122",
		NATS_URL: "nats://custom-nats:4222",
	});

	assert.deepEqual(normalizeStorageEnvironment(environment), {
		...environment,
		S3_ACCESS_KEY_ID: "custom-storage-user",
		S3_SECRET_ACCESS_KEY: "custom-storage-secret",
		S3_API_HOST_PORT: "8122",
	});
});

test("explicit S3 credentials and port take precedence over legacy values", () => {
	const environment = {
		S3_ACCESS_KEY_ID: "new-storage-user",
		S3_SECRET_ACCESS_KEY: "new-storage-secret",
		S3_API_HOST_PORT: "0",
		MINIO_ROOT_USER: "old-storage-user",
		MINIO_ROOT_PASSWORD: "old-storage-secret",
		MINIO_API_HOST_PORT: "8122",
	};

	assert.deepEqual(normalizeStorageEnvironment(environment), environment);
});

test("empty S3 settings fall back to configured legacy values", () => {
	assert.deepEqual(normalizeStorageEnvironment({
		S3_ACCESS_KEY_ID: "",
		S3_SECRET_ACCESS_KEY: "",
		S3_API_HOST_PORT: "",
		MINIO_ROOT_USER: "legacy-user",
		MINIO_ROOT_PASSWORD: "legacy-secret",
		MINIO_API_HOST_PORT: "8122",
	}), {
		S3_ACCESS_KEY_ID: "legacy-user",
		S3_SECRET_ACCESS_KEY: "legacy-secret",
		S3_API_HOST_PORT: "8122",
		MINIO_ROOT_USER: "legacy-user",
		MINIO_ROOT_PASSWORD: "legacy-secret",
		MINIO_API_HOST_PORT: "8122",
	});
});

test("unconfigured storage values leave defaults to the environment template", () => {
	const environment = {
		DATABASE_URL: "postgresql://database/wallpaperdb",
		MINIO_ROOT_USER: "",
		S3_SECRET_ACCESS_KEY: "",
	};

	assert.deepEqual(normalizeStorageEnvironment(environment), environment);
	assert.deepEqual(normalizeStorageEnvironment({}), {});
});
