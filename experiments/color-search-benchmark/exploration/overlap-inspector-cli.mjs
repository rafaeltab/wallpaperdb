import { once } from 'node:events';
import { createOverlapInspectorProvider } from './overlap-inspector-provider.mjs';
import { createOverlapInspectorServer } from './overlap-inspector-server.mjs';

const provider = await createOverlapInspectorProvider();
const server = createOverlapInspectorServer(provider);
server.listen(Number(process.env.COLOR_OVERLAP_INSPECTOR_PORT ?? 8227), process.env.COLOR_OVERLAP_INSPECTOR_HOST ?? '0.0.0.0');
await once(server, 'listening');
console.log(`Overlapping color inspector listening on http://0.0.0.0:${server.address().port}; ${provider.corpus.length} assets.`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
