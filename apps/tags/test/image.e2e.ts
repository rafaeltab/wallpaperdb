import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers';
import { expect, it } from 'vitest';

const collectorSource = `
const http = require('node:http');
const counts = { traces: 0, logs: 0, metrics: 0 };
http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/exports') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(counts));
    return;
  }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    try {
      JSON.parse(Buffer.concat(chunks).toString(), (key, value) => {
        if (Array.isArray(value)) {
          if (request.url === '/v1/traces' && key === 'spans') counts.traces += value.length;
          if (request.url === '/v1/logs' && key === 'logRecords') counts.logs += value.length;
          if (request.url === '/v1/metrics' && key === 'metrics') counts.metrics += value.length;
        }
        return value;
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    } catch {
      response.writeHead(400);
      response.end();
    }
  });
}).listen(8080, '0.0.0.0');
`;

const exportCounts = Schema.Struct({
  traces: Schema.Number,
  logs: Schema.Number,
  metrics: Schema.Number,
});

it('ships an image that serves operational endpoints and exports telemetry on shutdown', async () => {
  const image = await GenericContainer.fromDockerfile(
    fileURLToPath(new URL('../../../', import.meta.url)),
    'apps/tags/Dockerfile'
  ).build();
  const network = await new Network().start();
  const containers: StartedTestContainer[] = [];
  try {
    const postgres = await new GenericContainer('postgres:16-alpine')
      .withNetwork(network)
      .withNetworkAliases('database')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'tags' })
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    containers.push(postgres);
    const nats = await new GenericContainer('nats:2.10-alpine')
      .withNetwork(network)
      .withNetworkAliases('broker')
      .withWaitStrategy(Wait.forLogMessage('Server is ready'))
      .start();
    containers.push(nats);
    const collector = await new GenericContainer('node:22-alpine')
      .withNetwork(network)
      .withNetworkAliases('collector')
      .withExposedPorts(8080)
      .withCopyContentToContainer([{ content: collectorSource, target: '/collector.cjs' }])
      .withCommand(['node', '/collector.cjs'])
      .withWaitStrategy(Wait.forHttp('/exports', 8080).forStatusCode(200))
      .start();
    containers.push(collector);
    const service = await image
      .withNetwork(network)
      .withEnvironment({
        NODE_ENV: 'production',
        PORT: '3008',
        DATABASE_URL: 'postgresql://postgres:test@database:5432/tags',
        NATS_URL: 'nats://broker:4222',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:8080',
        OTEL_SERVICE_NAME: 'tags-image-contract',
      })
      .withExposedPorts(3008)
      .withWaitStrategy(Wait.forHttp('/ready', 3008).forStatusCode(200))
      .start();
    containers.push(service);

    const baseUrl = `http://${service.getHost()}:${service.getMappedPort(3008)}`;
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: 'healthy',
      checks: { database: true, nats: true, otel: true },
    });
    expect((await fetch(`${baseUrl}/tags`)).status).toBe(404);

    // Docker sends SIGTERM. Providers must flush before the process releases its scope.
    await service.stop({ timeout: 10000 });
    const exported = await fetch(
      `http://${collector.getHost()}:${collector.getMappedPort(8080)}/exports`
    );
    const counts = Schema.decodeUnknownSync(exportCounts)(await exported.json());
    expect(counts.traces).toBeGreaterThan(0);
    expect(counts.logs).toBeGreaterThan(0);
    expect(counts.metrics).toBeGreaterThan(0);
  } finally {
    const results = await Promise.allSettled(
      containers.reverse().map((container) => container.stop({ timeout: 10000 }))
    );
    await network.stop();
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
});
