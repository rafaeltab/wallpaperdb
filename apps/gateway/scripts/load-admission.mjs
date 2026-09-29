import { performance } from 'node:perf_hooks';

const endpoint = new URL(process.argv[2] ?? 'http://localhost:8000/gateway/graphql');
const requests = Number(process.argv[3] ?? 128);
const phase = process.argv[4] ?? 'healthy';
if (!Number.isSafeInteger(requests) || requests < 1)
  throw new Error('Request count must be positive');
const operations = {
  cheap: '{ getWallpaper(wallpaperId: "wlpr_load_missing") { wallpaperId } }',
  expensive: '{ searchWallpapers(first: 100) { edges { node { wallpaperId uploadedAt } } } }',
};

for (const [operation, query] of Object.entries(operations)) {
  for (const concurrency of [8, 16, 32, 64]) {
    const durations = [];
    const outcomes = {};
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next++ < requests) {
          const requestStarted = performance.now();
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal: AbortSignal.timeout(15000),
          });
          const body = await response.json();
          const outcome = `${response.status}:${body.errors?.[0]?.extensions?.code ?? 'ok'}`;
          outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
          durations.push(performance.now() - requestStarted);
        }
      })
    );
    durations.sort((a, b) => a - b);
    const percentile = (p) => Math.round(durations[Math.ceil(p * durations.length) - 1]);
    console.log(
      JSON.stringify({
        phase,
        operation,
        concurrency,
        requests,
        requestsPerSecond: Math.round((requests * 1000) / (performance.now() - started)),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        outcomes,
      })
    );
  }
}
