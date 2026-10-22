import { defineConfig, mergeConfig } from "vitest/config";
import unit from "./vitest.config.ts";

export default defineConfig(async (environment) => {
  const base = typeof unit === "function" ? await unit(environment) : await unit;
  return mergeConfig(base, {
    test: {
      env: {
        CRAP_TYPESCRIPT_COMMAND_TIMEOUT_MS: "300000"
      }
    }
  });
});
