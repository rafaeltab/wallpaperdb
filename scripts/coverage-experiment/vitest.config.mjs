import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
	new URL("../../.coverage-experiment/build/apps/user/", import.meta.url),
);
export default defineConfig({
	root,
	test: {
		name: "user-native-experiment",
		globals: true,
		environment: "node",
		include: process.env.EXPERIMENT_MOCK
			? [
					process.env.EXPERIMENT_MOCK === "app"
						? process.env.EXPERIMENT_MOCK_KIND
							? `test/coverage-experiment/${process.env.EXPERIMENT_MOCK_KIND}.qualification.js`
							: "test/coverage-experiment/app-mock.qualification.js"
						: process.env.EXPERIMENT_MOCK === "limits"
							? "test/coverage-experiment/dynamic-limit.qualification.js"
							: "test/coverage-experiment/mock.qualification.js",
				]
			: process.env.EXPERIMENT_INTEGRATION
				? ["test/**/*.integration.test.js"]
				: process.env.EXPERIMENT_CHILD
					? ["test/picture-codec-admission.integration.test.js"]
					: [
							"test/**/*.unit.test.js",
							"../../scripts/coverage-experiment/fixtures/qualification.fixture.js",
						],
		testTimeout: 60000,
		hookTimeout: 60000,
		maxWorkers: 5,
		allowOnly: false,
		passWithNoTests: false,
		retry: 0,
		expect: { requireAssertions: true },
		experimental: {
			viteModuleRunner: false,
			nodeLoader: process.env.EXPERIMENT_NODE_LOADER === "true",
		},
		coverage: {
			provider: "v8",
			autoAttachSubprocess: true,
			include: ["src/**/*.js"],
			exclude: ["src/**/*.test.js", "src/**/*.d.js"],
			reporter: ["json", "json-summary", "lcov"],
			reportsDirectory: fileURLToPath(
				new URL(
					"../../.coverage-experiment/reports/" +
						(process.env.EXPERIMENT_MOCK
							? "native-mock"
							: process.env.EXPERIMENT_INTEGRATION
								? "native-integration"
								: process.env.EXPERIMENT_CHILD
									? "native-child"
									: "native-unit"),
					import.meta.url,
				),
			),
		},
	},
});
