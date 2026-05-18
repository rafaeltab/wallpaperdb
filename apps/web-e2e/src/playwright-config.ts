import { devices, type PlaywrightTestConfig } from "@playwright/test";

import { BASE_USER_AUTH } from "./auth-state";
import { buildWebE2EBaseUrl } from "./environment-contract";

type WebE2EEnv = NodeJS.ProcessEnv;

export function buildWebE2EConfig(
  env: WebE2EEnv,
): Pick<
  PlaywrightTestConfig,
  "fullyParallel" | "projects" | "retries" | "testDir" | "use" | "workers"
> {
  const authSetupProjectName = `setup:${BASE_USER_AUTH.name}`;

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
        name: authSetupProjectName,
        testMatch: /.*\.setup\.ts/,
      },
      {
        name: "chromium",
        dependencies: [authSetupProjectName],
        testIgnore: /.*\.setup\.ts/,
        use: {
          ...devices["Desktop Chrome"],
          storageState: BASE_USER_AUTH.storageStatePath,
        },
      },
    ],
  };
}
