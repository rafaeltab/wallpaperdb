import { deepStrictEqual } from 'node:assert';
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
if (process.argv[2] === 'application-write') {
  process.on('uncaughtExceptionMonitor', (error) => {
    if ('code' in error) process.stdout.write(`uncaught=${error.code}\n`);
  });
}
const originalListeners = listeners();
const transports = Array.from({ length: 12 }, () => new TelemetryExportTransport());
const exporters = transports.slice(0, 2).map((transport) =>
  transport.monitor(
    new OTLPTraceExporter({
      ...transport.options,
      url: `http://127.0.0.1:${address.port}/private-collector-token/v1/traces`,
    })
  )
);

function listeners() {
  return {
    stderr: process.stderr.rawListeners('error'),
    exception: process.rawListeners('uncaughtException'),
    monitor: process.rawListeners('uncaughtExceptionMonitor'),
    exit: process.rawListeners('exit'),
    beforeExit: process.rawListeners('beforeExit'),
    warning: process.rawListeners('warning'),
  };
}

process.once('message', async () => {
  try {
    for (const exporter of exporters) {
      const result = await new Promise<{ code: number }>((resolve) => exporter.export([], resolve));
      process.send?.(`export-code=${result.code}`);
    }
    await setImmediate();
    deepStrictEqual(listeners(), originalListeners);
    process.send?.('application-alive');
    if (process.argv[2] === 'application-write') {
      process.stderr.write('unrelated application diagnostic\n');
      await setImmediate();
    }
  } finally {
    for (const exporter of exporters) await exporter.shutdown();
    for (const transport of transports) {
      await transport.close();
      await transport.close();
    }
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    deepStrictEqual(listeners(), originalListeners);
    if (process.argv[2] === 'healthy-reader') {
      await new Promise<void>((resolve, reject) => {
        process.stderr.write('application-stderr-after-close\n', (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    process.send?.('cleanup-complete');
    process.disconnect();
  }
});
process.send?.('ready');
