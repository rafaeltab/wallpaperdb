import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';

const endpoint = new URL(process.argv[2] ?? 'http://localhost:8000/gateway/graphql');
const requests = Number(process.argv[3] ?? 128);
const phase = process.argv[4] ?? 'healthy';
const mode = process.argv[5] ?? 'burst';
if (!Number.isSafeInteger(requests) || requests < 1)
  throw new Error('Request count must be positive');
if (!['burst', 'paced', 'bodies'].includes(mode)) throw new Error('Unknown load mode');
const operations = {
  cheap: '{ getWallpaper(wallpaperId: "wlpr_load_missing") { wallpaperId } }',
  expensive: '{ searchWallpapers(first: 100) { edges { node { wallpaperId uploadedAt } } } }',
};

async function send(payload) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return {
    durationMs: performance.now() - started,
    outcome: `${response.status}:${body?.errors?.[0]?.extensions?.code ?? (body?.data ? 'ok' : 'transport')}`,
    costLimit: response.headers.get('x-ratelimit-cost-limit'),
    retryAfterSeconds: response.headers.get('retry-after'),
    responseBytes: Buffer.byteLength(text),
  };
}

if (mode === 'bodies') {
  // Measure the shipped web operation text; variables vary with the workload.
  const source = await readFile(
    new URL('../../web/src/lib/graphql/queries.ts', import.meta.url),
    'utf8'
  );
  for (const [, name, query] of source.matchAll(/export const (\w+) = gql`([\s\S]*?)`;/g)) {
    console.log(
      JSON.stringify({
        phase,
        operation: name,
        queryEnvelopeBytes: Buffer.byteLength(JSON.stringify({ query })),
      })
    );
  }
  for (const bytes of [1024, 4096, 16384, 16385, 65536, 1048576, 1048577]) {
    const base = JSON.stringify({ query: operations.cheap });
    // Trailing JSON whitespace tests the raw body bound without increasing query cost.
    const result = await send(base.padEnd(bytes, ' '));
    console.log(JSON.stringify({ phase, bodyBytes: bytes, ...result }));
  }
} else {
  for (const [operation, query] of Object.entries(operations)) {
    for (const offered of mode === 'paced' ? [25, 50, 100, 200] : [8, 16, 32, 64]) {
      const results = [];
      let next = 0;
      let active = 0;
      let peakClientActive = 0;
      const started = performance.now();
      const run = async () => {
        active++;
        peakClientActive = Math.max(peakClientActive, active);
        try {
          results.push(await send(JSON.stringify({ query })));
        } finally {
          active--;
        }
      };
      if (mode === 'paced') {
        const pending = [];
        for (let index = 0; index < requests; index++) {
          await setTimeout(Math.max(0, started + (index * 1000) / offered - performance.now()));
          pending.push(run());
        }
        await Promise.all(pending);
      } else {
        await Promise.all(
          Array.from({ length: offered }, async () => {
            while (next++ < requests) await run();
          })
        );
      }
      const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
      const outcomes = {};
      for (const { outcome } of results) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      const percentile = (p) => Math.round(durations[Math.ceil(p * durations.length) - 1]);
      console.log(
        JSON.stringify({
          phase,
          operation,
          ...(mode === 'paced' ? { offeredRequestsPerSecond: offered } : { concurrency: offered }),
          requests,
          peakClientActive,
          requestsPerSecond: Math.round((requests * 1000) / (performance.now() - started)),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
          outcomes,
          costLimits: [...new Set(results.map((result) => result.costLimit))],
          maxRetryAfterSeconds: Math.max(
            0,
            ...results.map((result) => Number(result.retryAfterSeconds))
          ),
        })
      );
    }
  }
}
