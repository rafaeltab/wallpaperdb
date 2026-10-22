import type { IncomingHttpHeaders } from 'node:http';
import { Effect } from 'effect';
import type { FastifyInstance } from 'fastify';
import { AuthorAuthentication } from '../adapters/authors/index.js';
import { Lifecycle } from '../capabilities/lifecycle/index.js';
export interface AuthorExecution {
  run<A, E>(
    effect: Effect.Effect<A, E, AuthorAuthentication | Lifecycle>,
    headers: IncomingHttpHeaders,
    signal?: AbortSignal
  ): Promise<A>;
}
const problem = (status: number, name: string, title: string) => ({
  type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
  status,
  title,
});
export function registerAuthorRoutes(app: FastifyInstance, execution?: AuthorExecution) {
  app.get<{ Params: { assetId: string } }>(
    '/assets/:assetId/sources',
    {
      schema: {
        summary: "Inspect the authenticated Owner's active Sources",
        tags: ['Assets'],
        params: {
          type: 'object',
          required: ['assetId'],
          properties: { assetId: { type: 'string', minLength: 1, maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!execution)
        return reply
          .code(401)
          .type('application/problem+json')
          .send(problem(401, 'unauthorized', 'Authentication required'));
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      reply.raw.once('close', abort);
      try {
        const result = await execution.run(
          Effect.gen(function* () {
            const authentication = yield* AuthorAuthentication;
            const owner = yield* authentication.verify(request.headers.authorization);
            if (!owner)
              return { status: 401, body: problem(401, 'unauthorized', 'Authentication required') };
            const lifecycle = yield* Lifecycle;
            const inspected = yield* lifecycle.inspect(owner, request.params.assetId);
            return inspected.kind === 'found'
              ? { status: 200, body: inspected.asset }
              : { status: 404, body: problem(404, 'not-found', 'Asset unavailable') };
          }).pipe(
            Effect.catch(() =>
              Effect.succeed({
                status: 503,
                body: problem(503, 'service-unavailable', 'Service unavailable'),
              })
            )
          ),
          request.headers,
          controller.signal
        );
        return reply
          .code(result.status)
          .type(result.status === 200 ? 'application/json' : 'application/problem+json')
          .send(result.body);
      } finally {
        request.raw.off('aborted', abort);
        reply.raw.off('close', abort);
      }
    }
  );
}
