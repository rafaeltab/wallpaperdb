import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ManagedRuntime } from 'effect';
import { OpenSearchGateway, openSearchLayer } from '../../src/adapters/opensearch/index.js';
import { colorUtilityFields } from '../../src/capabilities/catalogue/index.js';

/** A supplied wire mapping tests inspection only; native contracts prove server acceptance. */
export function wallpaperMapping() {
  const properties: Record<string, Record<string, unknown>> = {
    wallpaperId: { type: 'keyword' },
    userId: { type: 'keyword' },
    variants: {
      type: 'nested',
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
        aspectRatio: { type: 'float' },
        format: { type: 'keyword' },
        fileSizeBytes: { type: 'long' },
        createdAt: { type: 'date' },
      },
    },
    colorReady: { type: 'keyword' },
    colorSnapshot: { type: 'object', enabled: false },
    colorOrder: { type: 'keyword', index: false },
    variantOrder: { type: 'object', enabled: false },
    uploadedAt: { type: 'date' },
    updatedAt: { type: 'date' },
    utilities: {
      dynamic: 'strict',
      properties: Object.fromEntries(colorUtilityFields.map((key) => [key, { type: 'float' }])),
    },
  };
  return { _source: { excludes: ['utilities'] }, properties };
}

export function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function withSearchEndpoint<T>(
  respond: (request: IncomingMessage, response: ServerResponse) => void,
  use: (options: { url: string; wallpaperIndex: string; profileIndex: string }) => Promise<T>,
  mapping: unknown = wallpaperMapping()
) {
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === 'HEAD' && ['/wallpapers', '/profiles'].includes(request.url ?? '')) {
      response.writeHead(200);
      response.end();
    } else if (request.method === 'GET' && request.url === '/wallpapers/_mapping') {
      json(response, { wallpapers: { mappings: mapping } });
    } else if (request.method === 'PUT' && request.url === '/profiles/_mapping') {
      json(response, { acknowledged: true });
    } else {
      respond(request, response);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    return await use({
      url: `http://127.0.0.1:${address.port}`,
      wallpaperIndex: 'wallpapers',
      profileIndex: 'profiles',
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

export async function withControlledSearch<T>(
  respond: (request: IncomingMessage, response: ServerResponse) => void,
  use: (adapter: OpenSearchGateway, dispose: () => Promise<void>) => Promise<T>
) {
  return withSearchEndpoint(respond, async (options) => {
    const runtime = ManagedRuntime.make(openSearchLayer(options));
    try {
      return await use(await runtime.runPromise(OpenSearchGateway), () => runtime.dispose());
    } finally {
      await runtime.dispose();
    }
  });
}
