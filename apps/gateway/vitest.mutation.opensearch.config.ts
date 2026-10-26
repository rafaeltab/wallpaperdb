import { defineBaseConfig } from "@wallpaperdb/vitest-config";

// Explicit Profile discovery pilot. Normal Gateway integration remains Redis.
export default defineBaseConfig({
	test: {
		name: "gateway-mutation-opensearch-profile",
		environment: "node",
		include: ["test/search/profile-search.integration.test.ts"],
		globalSetup: ["./test/mutation-opensearch-global-setup.ts"],
		setupFiles: ["./test/mutation-opensearch-setup.ts"],
		testTimeout: 10000,
		hookTimeout: 10000,
		retry: 0,
		maxWorkers: 1,
		maxConcurrency: 1,
		isolate: true,
	},
});
