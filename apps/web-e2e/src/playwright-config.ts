import { devices, type PlaywrightTestConfig } from "@playwright/test";
import { join } from "node:path";

import { BASE_USER_AUTH, resolveAuthStorageStatePath } from "./auth-state";
import { buildWebE2EBaseUrl } from "./environment-contract";

type WebE2EEnv = NodeJS.ProcessEnv;

export function buildWebE2EConfig(
  env: WebE2EEnv,
): Pick<
  PlaywrightTestConfig,
  | "fullyParallel"
  | "forbidOnly"
  | "failOnFlakyTests"
  | "outputDir"
  | "projects"
  | "reporter"
  | "retries"
  | "testDir"
  | "use"
  | "workers"
> {
  const authSetupProjectName = `setup:${BASE_USER_AUTH.name}`;
  const artifacts = env.E2E_ARTIFACTS_DIR;

  return {
    testDir: "./specs",
    fullyParallel: false,
    forbidOnly: true,
    failOnFlakyTests: true,
    workers: 1,
    retries: env.CI ? 1 : 0,
    outputDir: artifacts ? join(artifacts, "test-results") : "test-results",
    reporter: [
      ["list"],
      [
        "html",
        {
          open: "never",
          outputFolder: artifacts
            ? join(artifacts, "playwright-report")
            : "playwright-report",
        },
      ],
    ],
    use: {
      baseURL: buildWebE2EBaseUrl(env),
      screenshot: "only-on-failure",
      trace: "retain-on-failure",
      video: "retain-on-failure",
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
          storageState: resolveAuthStorageStatePath(env),
        },
      },
    ],
  };
}
