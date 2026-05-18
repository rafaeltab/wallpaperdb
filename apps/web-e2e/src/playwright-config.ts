import { devices, type PlaywrightTestConfig } from "@playwright/test";

import { buildWebE2EBaseUrl } from "./environment-contract";

type WebE2EEnv = NodeJS.ProcessEnv;

export function buildWebE2EConfig(
  env: WebE2EEnv,
): Pick<
  PlaywrightTestConfig,
  "fullyParallel" | "projects" | "retries" | "testDir" | "use" | "workers"
> {
  return {
    testDir: "./specs",
    fullyParallel: false,
    workers: 1,
    retries: env.CI ? 1 : 0,
    use: {
      baseURL: buildWebE2EBaseUrl(env),
    },
    projects: [
      {
        name: "chromium",
        use: {
          ...devices["Desktop Chrome"],
        },
      },
    ],
  };
}
