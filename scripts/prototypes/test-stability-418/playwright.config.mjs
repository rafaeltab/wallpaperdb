import { createRequire } from "node:module";
const require = createRequire(
	new URL("../../../apps/web-e2e/package.json", import.meta.url),
);
const { defineConfig } = require("@playwright/test");

export default defineConfig({
	testDir: "./controls",
	workers: 1,
	fullyParallel: false,
	retries: 1,
	failOnFlakyTests: process.env.STABILITY_STRICT_RETRIES === "1",
	timeout: 5000,
	outputDir: process.env.STABILITY_PW_OUTPUT,
	reporter: [["list"], ["json", { outputFile: process.env.STABILITY_REPORT }]],
	projects: [
		{ name: "setup", testMatch: "dependency.setup.mjs" },
		{
			name: "retry-control",
			testMatch: "retry.pw-fixture.mjs",
			dependencies: ["setup"],
		},
	],
});
