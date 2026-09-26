import type { UserConfig } from "vitest/config";

/** Shared policy without a runtime dependency on a particular Vitest installation. */
export const defaults = {
	test: {
		silent: "passed-only",
		slowTestThreshold: 10000,
		coverage: {
			// Vitest 3 otherwise omits anonymous callback metadata. Vitest 5 uses AST remapping by default.
			experimentalAstAwareRemapping: true,
			reporter: ["json", "html", "lcov", "json-summary"],
		},
	},
} satisfies UserConfig;
