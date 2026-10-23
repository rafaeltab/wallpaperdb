import type { ViteUserConfig } from "vitest/config";

/** Shared policy without a runtime dependency on a particular Vitest installation. */
export const defaults = {
	test: {
		allowOnly: false,
		passWithNoTests: false,
		retry: 0,
		expect: { requireAssertions: true },
		silent: "passed-only",
		slowTestThreshold: 10000,
		coverage: {
			reporter: ["json", "html", "lcov", "json-summary"],
		},
	},
} satisfies ViteUserConfig;
