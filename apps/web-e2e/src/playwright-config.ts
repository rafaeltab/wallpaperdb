import { devices, type PlaywrightTestConfig } from "@playwright/test";

type WebE2EEnv = NodeJS.ProcessEnv;

export function buildWebE2EConfig(
  env: WebE2EEnv,
): Pick<
  PlaywrightTestConfig,
  "fullyParallel" | "projects" | "retries" | "testDir" | "use" | "workers"
> {
  const ingressPort = env.INGRESS_PORT ?? "8000";

  return {
    testDir: "./specs",
    fullyParallel: false,
    workers: 1,
    retries: env.CI ? 1 : 0,
    use: {
      baseURL: env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${ingressPort}/web`,
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
