import { createServer, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { expect, it, vi } from 'vitest';
import { TelemetryExportTransport, telemetryBatchOptions } from '@wallpaperdb/core/telemetry';

it('bounds streaming collector sockets and preserves a local diagnostic without exporting it', async () => {
  const sockets = new Set<Socket>();
  let connections = 0;
  let healthy = false;
  const collector = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (healthy) {
        response.end('{}');
        return;
      }
      response.writeHead(200);
      response.write(' ');
      const stream = setInterval(() => response.write(' '), 20);
      response.once('close', () => clearInterval(stream));
    });
  });
  collector.on('connection', (socket) => {
    connections++;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  const transport = new TelemetryExportTransport();
  const exporter = transport.monitor(
    new OTLPTraceExporter({
      ...transport.options,
      url: `http://127.0.0.1:${address.port}/private-collector-token/v1/traces`,
    })
  );
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await new Promise((resolve) => exporter.export([], resolve));
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    expect(write.mock.calls.map(([message]) => message).join('')).toContain(
      'telemetry export unavailable'
    );
    const started = performance.now();
    const results = await Promise.all(
      Array.from(
        { length: 20 },
        () => new Promise<{ code: number }>((resolve) => exporter.export([], resolve))
      )
    );
    expect(performance.now() - started).toBeLessThan(2500);
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    expect(connections).toBe(2);
    expect(results.filter((result) => result.code !== 0).length).toBeGreaterThanOrEqual(19);
    expect(write.mock.calls.map(([message]) => message).join('')).toContain(
      'telemetry export unavailable'
    );
    expect(write.mock.calls.map(([message]) => message).join('')).not.toContain(
      'private-collector-token'
    );
    expect(write).toHaveBeenCalledTimes(1);
    healthy = true;
    await expect(new Promise((resolve) => exporter.export([], resolve))).resolves.toMatchObject({
      code: 0,
    });
    expect(connections).toBe(3);
    expect(write).toHaveBeenCalledTimes(1);
    await transport.close();
    await expect(new Promise((resolve) => exporter.export([], resolve))).resolves.toMatchObject({
      code: 1,
    });
    expect(connections).toBe(3);
  } finally {
    write.mockRestore();
    await transport.close();
    await exporter.shutdown();
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

it('drops excess pending spans while a collector is unavailable and exports new work after recovery', async () => {
  let blocked = true;
  let received = 0;
  const pending: ServerResponse[] = [];
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      JSON.parse(Buffer.concat(chunks).toString(), (key, value) => {
        if (key === 'spans') received += value.length;
        return value;
      });
      if (blocked) pending.push(response);
      else response.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  const transport = new TelemetryExportTransport();
  const exporter = transport.monitor(
    new OTLPTraceExporter({
      ...transport.options,
      // Isolate the processor queue policy from the separately tested export limit.
      concurrencyLimit: 64,
      url: `http://127.0.0.1:${address.port}/v1/traces`,
    })
  );
  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter, telemetryBatchOptions)],
  });
  try {
    const tracer = provider.getTracer('queue-contract');
    for (let index = 0; index < 2000; index++) tracer.startSpan('bounded-work').end();
    await vi.waitFor(() => expect(pending.length).toBe(1));
    blocked = false;
    for (const response of pending) response.end('{}');
    await provider.forceFlush();
    await exporter.forceFlush();
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThanOrEqual(320);
    const before = received;
    tracer.startSpan('recovered-work').end();
    await provider.forceFlush();
    expect(received).toBe(before + 1);
  } finally {
    await provider.shutdown();
    await transport.close();
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});
