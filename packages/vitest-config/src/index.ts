import { defineConfig, mergeConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";

export function defineBaseConfig(
	overrides: UserConfig,
): ReturnType<typeof defineConfig> {
	const base = defineConfig({
		test: {
			// Vitest v3: buffer console.* per test; discard on pass, show on fail
			// biome-ignore lint/suspicious/noExplicitAny: vitest v3 type, not yet installed
			silent: "passed-only" as any,
			// Integration tests routinely take 300ms–8s; don't flag them as "slow"
			// (default 300ms causes every integration test name to be printed)
			slowTestThreshold: 10000,
			coverage: {
				// "text" removed — no more per-file stdout table
				reporter: ["json", "html", "lcov", "json-summary"],
			},
		},
	});
	// biome-ignore lint/suspicious/noExplicitAny: mergeConfig overload types differ between vitest v2/v3
	return mergeConfig(base, overrides as any) as ReturnType<typeof defineConfig>;
}
