import { defineConfig, mergeConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";
import { defaults } from "./defaults.js";

export function defineBaseConfig(
	overrides: ViteUserConfig,
): ReturnType<typeof defineConfig> {
	return defineConfig(mergeConfig(defaults, overrides));
}
