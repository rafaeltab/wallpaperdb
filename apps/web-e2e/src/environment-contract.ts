type WebE2EEnv = NodeJS.ProcessEnv;

type FetchLike = typeof fetch;

type ProbeResult = {
  url: string;
  status?: number;
  body?: string;
  error?: string;
};

type ServiceContract = {
  name: string;
  routePrefix: string;
};

const SERVICE_CONTRACTS: ServiceContract[] = [
  { name: "ingestor", routePrefix: "/ingestor" },
  { name: "media", routePrefix: "/media" },
  { name: "gateway", routePrefix: "/gateway" },
  { name: "variant-generator", routePrefix: "/variant-generator" },
  { name: "color-extractor", routePrefix: "/color-extractor" },
  { name: "user", routePrefix: "/user" },
];

export function buildWebE2EBaseUrl(env: WebE2EEnv): string {
  const ingressPort = env.INGRESS_PORT ?? "8000";

  return env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${ingressPort}/web`;
}

export function buildIngressOrigin(env: WebE2EEnv): string {
  return new URL(buildWebE2EBaseUrl(env)).origin;
}

export async function verifyWebE2EEnvironment(
  env: WebE2EEnv,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const baseUrl = buildWebE2EBaseUrl(env);
  const ingressOrigin = buildIngressOrigin(env);

  const webProbe = await probeEndpoint(fetchImpl, baseUrl);
  const readinessResults = await Promise.all(
    SERVICE_CONTRACTS.map(async (service) => {
      const readyUrl = `${ingressOrigin}${service.routePrefix}/ready`;
      const readyProbe = await probeEndpoint(fetchImpl, readyUrl);

      if (isSuccessful(readyProbe)) {
        return { service, readyProbe };
      }

      const healthProbe = await probeEndpoint(
        fetchImpl,
        `${ingressOrigin}${service.routePrefix}/health`,
      );

      return { service, readyProbe, healthProbe };
    }),
  );

  const failedReadiness = readinessResults.filter(
    (result) => !isSuccessful(result.readyProbe),
  );

  if (isSuccessful(webProbe) && failedReadiness.length === 0) {
    return;
  }

  throw new Error(
    formatEnvironmentFailure({
      baseUrl,
      webProbe,
      failedReadiness,
    }),
  );
}

function isSuccessful(probe: ProbeResult): boolean {
  return probe.error === undefined && probe.status !== undefined && probe.status < 400;
}

async function probeEndpoint(
  fetchImpl: FetchLike,
  url: string,
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
    });

    return {
      url,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatEnvironmentFailure({
  baseUrl,
  webProbe,
  failedReadiness,
}: {
  baseUrl: string;
  webProbe: ProbeResult;
  failedReadiness: Array<{
    service: ServiceContract;
    readyProbe: ProbeResult;
    healthProbe?: ProbeResult;
  }>;
}): string {
  const lines = [
    "Browser E2E environment verification failed.",
    `Playwright base URL: ${baseUrl}`,
  ];

  if (!isSuccessful(webProbe)) {
    lines.push(
      formatProbeSummary("web base URL", webProbe),
      formatProbeBody("web base URL response", webProbe.body),
    );
  }

  for (const failure of failedReadiness) {
    lines.push(
      formatProbeSummary(`${failure.service.name} readiness`, failure.readyProbe),
      formatProbeBody(`${failure.service.name} /ready body`, failure.readyProbe.body),
    );

    if (failure.healthProbe) {
      lines.push(
        formatProbeSummary(`${failure.service.name} health`, failure.healthProbe),
        formatProbeBody(`${failure.service.name} /health body`, failure.healthProbe.body),
      );
    }
  }

  lines.push(
    "Start the local stack before rerunning browser E2E:",
    "make infra-start",
    "make dev",
  );

  return lines.join("\n");
}

function formatProbeSummary(label: string, probe: ProbeResult): string {
  if (probe.error) {
    return `${label}: ${probe.url} -> connection error: ${probe.error}`;
  }

  return `${label}: ${probe.url} -> HTTP ${probe.status}`;
}

function formatProbeBody(label: string, body?: string): string {
  const trimmedBody = body?.trim();

  return `${label}: ${trimmedBody && trimmedBody.length > 0 ? trimmedBody : "<empty>"}`;
}
