import { defineConfig, mergeConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";
import { defaults } from "./defaults.js";

export function defineBaseConfig(
	overrides: UserConfig,
): ReturnType<typeof defineConfig> {
	return defineConfig(mergeConfig(defaults, overrides));
}
