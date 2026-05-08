import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildWebE2EConfig } from "../src/playwright-config";

describe("buildWebE2EConfig", () => {
  it("runs serially against the ingress-routed /web base URL by default", () => {
    const config = buildWebE2EConfig({
      INGRESS_PORT: "8120",
    } as NodeJS.ProcessEnv);

    expect(config.fullyParallel).toBe(false);
    expect(config.workers).toBe(1);
    expect(config.use?.baseURL).toBe("http://localhost:8120/web");
    expect(config.projects?.map((project) => project.name)).toEqual([
      "chromium",
    ]);
  });

  it("honors an explicit Playwright base URL override", () => {
    const config = buildWebE2EConfig({
      PLAYWRIGHT_BASE_URL: "http://localhost:9450/web",
      INGRESS_PORT: "8120",
    } as NodeJS.ProcessEnv);

    expect(config.use?.baseURL).toBe("http://localhost:9450/web");
  });

  it("enables one retry in CI and no retries locally", () => {
    const localConfig = buildWebE2EConfig({} as NodeJS.ProcessEnv);
    const ciConfig = buildWebE2EConfig({ CI: "true" } as NodeJS.ProcessEnv);

    expect(localConfig.retries).toBe(0);
    expect(ciConfig.retries).toBe(1);
  });
});

describe("workspace commands", () => {
  it("keeps browser E2E out of the default test path while exposing dedicated commands", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string | undefined> };

    expect(packageJson.scripts.test).toBeUndefined();
    expect(packageJson.scripts["test:e2e"]).toBeDefined();
    expect(packageJson.scripts["test:e2e:ui"]).toBeDefined();
    expect(packageJson.scripts["test:unit"]).toBeDefined();
  });
});
