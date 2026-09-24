import { once } from 'node:events';
import { createHistogramInspectorProvider } from './histogram-inspector-provider.mjs';
import { createHistogramInspectorServer } from './histogram-inspector-server.mjs';

const provider = await createHistogramInspectorProvider();
const server = createHistogramInspectorServer(provider);
server.listen(Number(process.env.COLOR_HISTOGRAM_INSPECTOR_PORT ?? 8226), process.env.COLOR_HISTOGRAM_INSPECTOR_HOST ?? '0.0.0.0');
await once(server, 'listening');
console.log(`Histogram inspector listening on http://0.0.0.0:${server.address().port}; ${provider.corpus.length} assets.`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
