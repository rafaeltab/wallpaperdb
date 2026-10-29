import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
it('exports telemetry with incoming trace context through the composed runtime and closes its exporter', async () => {
  const host = await protocol();
  const prior = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const payloads: string[] = [];
  const collector = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      payloads.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('No collector address');
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
      FACTORY_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
    });
    const traceId = '12345678901234567890123456789012';
    try {
      expect(
        (
          await running.app.inject({
            url: '/api/job',
            headers: { traceparent: `00-${traceId}-1234567890123456-01` },
          })
        ).statusCode
      ).toBe(200);
    } finally {
      await running.close();
    }
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.join('')).toContain(traceId);
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (prior === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = prior;
    await host.cleanup();
  }
});

it('bounds a stalled collector during cleanup without leaving exporter sockets', async () => {
  const host = await protocol();
  const prior = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const sockets = new Set<import('node:net').Socket>();
  const collector = createServer((request, response) => {
    request.resume();
    response.writeHead(200);
    response.write(' ');
  });
  collector.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector');
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
      FACTORY_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
    });
    await running.app.inject('/api/job');
    const started = performance.now();
    await running.close();
    expect(performance.now() - started).toBeLessThan(6000);
    await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 1000 });
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (prior === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = prior;
    await host.cleanup();
  }
});
