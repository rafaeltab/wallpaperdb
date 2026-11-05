import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/** Both the bundled release and source-run backend serve the same Vite build. */
export function serveAssets(app: FastifyInstance) {
  const root = new URL(
    import.meta.url.endsWith('/main.js') ? './frontend/' : '../../dist/frontend/',
    import.meta.url
  );
  app.get('/', async (_request, reply) =>
    reply
      .header('cache-control', 'no-cache')
      .type('text/html')
      .send(await readFile(new URL('index.html', root)))
  );
  app.get('/assets/:file', async (request, reply) => {
    const { file } = z.object({ file: z.string() }).parse(request.params);
    if (!/^[\w-]+\.(js|css)$/.test(file)) return reply.code(404).send();
    try {
      return reply
        .type(file.endsWith('.css') ? 'text/css' : 'text/javascript')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(await readFile(new URL(`assets/${file}`, root)));
    } catch {
      return reply.code(404).send();
    }
  });
}
