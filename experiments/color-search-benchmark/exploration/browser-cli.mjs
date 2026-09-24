import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startBrowserServer } from './browser.mjs';

const moduleUrl = process.env.COLOR_EXPLORATION_PROVIDER
  ? pathToFileURL(resolve(process.env.COLOR_EXPLORATION_PROVIDER))
  : new URL('./browser-provider.mjs', import.meta.url);
const { createBrowserProvider } = await import(moduleUrl.href);
const provider = await createBrowserProvider();
const server = await startBrowserServer({
  ...provider,
  host: process.env.COLOR_EXPLORATION_HOST ?? '0.0.0.0',
  port: Number(process.env.COLOR_EXPLORATION_PORT ?? 8225),
});
console.log(`Color query lab listening on http://0.0.0.0:${server.address().port}; ${provider.methods.length} methods, ${provider.corpus.length} assets.`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(async () => { await provider.close?.(); process.exit(0); });
  server.closeIdleConnections();
});
