import { defineConfig, mergeConfig } from "vitest/config";
import unit from "./vitest.config.ts";

export default defineConfig(async (environment) => {
	const base =
		typeof unit === "function" ? await unit(environment) : await unit;
	return mergeConfig(base, {
		test: {
			env: {
				// Define every loadConfig input before dotenv can load ambient values.
				DOTENV_KEY: "",
				NODE_ENV: "test",
				PORT: "3006",
				S3_ENDPOINT: "http://127.0.0.1:9000",
				S3_ACCESS_KEY_ID: "mutation",
				S3_SECRET_ACCESS_KEY: "mutation",
				S3_BUCKET: "wallpapers",
				S3_REGION: "us-east-1",
				NATS_URL: "nats://127.0.0.1:4222",
				NATS_STREAM: "WALLPAPER",
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
				OTEL_SERVICE_NAME: "variant-generator-mutation",
				JPEG_QUALITY: "90",
				WEBP_QUALITY: "90",
				PNG_COMPRESSION_LEVEL: "6",
			},
		},
	});
});
