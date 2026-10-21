import { createServer } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { TelemetryExportTransport } from '@wallpaperdb/core/telemetry';

// IPC stays usable after the parent closes the diagnostic pipe.
const collector = createServer((request, response) => {
  request.resume();
  response.writeHead(400);
  response.end('collector response must not reach diagnostic output');
});
await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
const address = collector.address();
if (!address || typeof address === 'string') throw new Error('Missing collector address');
const transport = new TelemetryExportTransport();
const exporter = transport.monitor(
  new OTLPTraceExporter({
    ...transport.options,
    url: `http://127.0.0.1:${address.port}/v1/traces`,
  })
);

process.once('message', async () => {
  try {
    const result = await new Promise<{ code: number }>((resolve) => exporter.export([], resolve));
    process.send?.(`export-code=${result.code}`);
    await setImmediate();
    process.send?.('application-alive');
  } finally {
    await exporter.shutdown();
    await transport.close();
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    process.send?.('cleanup-complete');
    process.disconnect();
  }
});
process.send?.('ready');
