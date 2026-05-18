import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { BASE_USER_AUTH, resolveAuthCredentials } from "../src/auth-state";
import {
  buildIngressOrigin,
  buildWebE2EBaseUrl,
  verifyWebE2EEnvironment,
} from "../src/environment-contract";
import { buildWebE2EConfig } from "../src/playwright-config";

function createFetchMock(
  implementation: (url: string) => Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) =>
    implementation(String(input)),
  ) as typeof fetch;
}

describe("buildWebE2EConfig", () => {
  it("runs serially against the ingress-routed /web base URL by default", () => {
    const config = buildWebE2EConfig({
      INGRESS_PORT: "8120",
    } as NodeJS.ProcessEnv);

    expect(config.fullyParallel).toBe(false);
    expect(config.workers).toBe(1);
    expect(config.use?.baseURL).toBe("http://localhost:8120/web");
    expect(
      config.projects?.find((project) => project.name === "chromium")?.dependencies,
    ).toEqual(["setup:base-user"]);
    expect(
      config.projects?.find((project) => project.name === "chromium")?.use,
    ).toEqual(
      expect.objectContaining({
        storageState: BASE_USER_AUTH.storageStatePath,
      }),
    );
    expect(config.projects?.map((project) => project.name)).toEqual([
      "setup:base-user",
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

  it("keeps auth setup isolated from dependent browser specs", () => {
    const config = buildWebE2EConfig({} as NodeJS.ProcessEnv);

    const setupProject = config.projects?.find(
      (project) => project.name === "setup:base-user",
    );
    const chromiumProject = config.projects?.find(
      (project) => project.name === "chromium",
    );

    expect(String(setupProject?.testMatch)).toContain("\\.setup\\.ts");
    expect(String(chromiumProject?.testIgnore)).toContain("\\.setup\\.ts");
  });
});

describe("auth state contract", () => {
  it("reads the seeded base-user credentials from environment", () => {
    expect(
      resolveAuthCredentials({
        E2E_BASE_TEST_EMAIL: " test.base@example.com ",
        E2E_BASE_TEST_PASSWORD: " secret ",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      email: "test.base@example.com",
      password: "secret",
    });
  });

  it("fails clearly when required auth environment values are missing", () => {
    expect(() =>
      resolveAuthCredentials({
        E2E_BASE_TEST_EMAIL: "",
      } as NodeJS.ProcessEnv),
    ).toThrowError(/E2E_BASE_TEST_EMAIL and E2E_BASE_TEST_PASSWORD/);
  });
});

describe("environment contract", () => {
  it("derives the ingress origin from the browser base URL contract", () => {
    expect(buildWebE2EBaseUrl({ INGRESS_PORT: "8120" } as NodeJS.ProcessEnv)).toBe(
      "http://localhost:8120/web",
    );
    expect(
      buildIngressOrigin({
        PLAYWRIGHT_BASE_URL: "http://localhost:9450/web",
      } as NodeJS.ProcessEnv),
    ).toBe("http://localhost:9450");
  });

  it("passes when the web app and every ingress-routed service report ready", async () => {
    const fetchMock = createFetchMock(async (url) => {
      if (url === "http://localhost:8120/web") {
        return new Response("<html></html>", { status: 200 });
      }

      if (url.startsWith("http://localhost:8120/") && url.endsWith("/ready")) {
        return new Response('{"ready":true}', { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      verifyWebE2EEnvironment(
        { INGRESS_PORT: "8120" } as NodeJS.ProcessEnv,
        fetchMock,
      ),
    ).resolves.toBeUndefined();
  });

  it("prints readiness and health diagnostics when a service is not ready", async () => {
    const fetchMock = createFetchMock(async (url) => {
      if (url === "http://localhost:8120/web") {
        return new Response("<html></html>", { status: 200 });
      }

      if (url === "http://localhost:8120/media/ready") {
        return new Response('{"ready":false,"reason":"booting"}', {
          status: 503,
        });
      }

      if (url === "http://localhost:8120/media/health") {
        return new Response('{"status":"degraded"}', { status: 200 });
      }

      if (url.startsWith("http://localhost:8120/") && url.endsWith("/ready")) {
        return new Response('{"ready":true}', { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      verifyWebE2EEnvironment(
        { INGRESS_PORT: "8120" } as NodeJS.ProcessEnv,
        fetchMock,
      ),
    ).rejects.toThrowError(
      /media readiness: http:\/\/localhost:8120\/media\/ready -> HTTP 503[\s\S]*media \/ready body: \{"ready":false,"reason":"booting"\}[\s\S]*media health: http:\/\/localhost:8120\/media\/health -> HTTP 200[\s\S]*media \/health body: \{"status":"degraded"\}[\s\S]*make infra-start[\s\S]*make dev/s,
    );
  });

  it("reports web base URL failures before Playwright launches", async () => {
    const fetchMock = createFetchMock(async (url) => {
      if (url === "http://localhost:8120/web") {
        return new Response("gateway timeout", { status: 502 });
      }

      if (url.startsWith("http://localhost:8120/") && url.endsWith("/ready")) {
        return new Response('{"ready":true}', { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      verifyWebE2EEnvironment(
        { INGRESS_PORT: "8120" } as NodeJS.ProcessEnv,
        fetchMock,
      ),
    ).rejects.toThrowError(
      /web base URL: http:\/\/localhost:8120\/web -> HTTP 502[\s\S]*web base URL response: gateway timeout/s,
    );
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
    expect(packageJson.scripts["test:e2e"]).toContain(
      "node --experimental-strip-types ./src/verify-environment.ts &&",
    );
    expect(packageJson.scripts["test:e2e:ui"]).toContain(
      "node --experimental-strip-types ./src/verify-environment.ts &&",
    );
  });

  it("commits two image fixtures for the first authenticated upload flow", () => {
    const fixturePaths = [
      new URL("../fixtures/fixture-a.png", import.meta.url),
      new URL("../fixtures/fixture-b.jpg", import.meta.url),
    ];

    for (const fixturePath of fixturePaths) {
      expect(existsSync(fixturePath)).toBe(true);
      expect(statSync(fixturePath).size).toBeGreaterThan(0);
    }
  });
});
