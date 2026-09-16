import type { UserConfig } from "vitest/config";

/** Shared policy without a runtime dependency on a particular Vitest installation. */
export const defaults = {
	test: {
		silent: "passed-only",
		slowTestThreshold: 10000,
		coverage: {
			reporter: ["json", "html", "lcov", "json-summary"],
		},
	},
} satisfies UserConfig;
