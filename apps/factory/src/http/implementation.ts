import Fastify from 'fastify';
import { z } from 'zod';
import { Unavailable, type Job, type StartResult } from '../capabilities/job/index.js';
import { page } from './page.js';
const startSchema = z
  .object({ issue: z.number().int().positive().safe(), context: z.string().max(16000).default('') })
  .strict();
export function operationsServer(config: {
  base: string;
  run: <A>(
    effect: import('effect').Effect.Effect<A, import('../capabilities/job/index.js').Unavailable>
  ) => Promise<A>;
  job: Job;
}) {
  const app = Fastify({ bodyLimit: 20000 });
  const problem = (status: number, type: string, title: string) => ({
    status,
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
    title,
  });
  app.setErrorHandler((error, _request, reply) => {
    const parsed = z
      .object({ statusCode: z.union([z.literal(400), z.literal(413), z.literal(415)]) })
      .safeParse(error);
    if (parsed.success)
      return reply
        .code(parsed.data.statusCode)
        .type('application/problem+json')
        .send(problem(parsed.data.statusCode, 'factory-request', 'Invalid request'));
    if (error instanceof Unavailable)
      return reply
        .code(503)
        .type('application/problem+json')
        .send(
          problem(
            503,
            'factory-unavailable',
            'Factory dependency unavailable. The durable reservation is preserved.'
          )
        );
    return reply
      .code(500)
      .type('application/problem+json')
      .send(problem(500, 'generic-server', 'Unexpected server failure'));
  });
  app.get('/health', () => ({ status: 'ok' }));
  app.get('/api/job', () => config.run(config.job.status()));
  app.get('/', async (_request, reply) =>
    reply.type('text/html').send(page(await config.run(config.job.status())))
  );
  app.post('/api/job', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== `${request.protocol}://${request.headers.host}`)
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'factory-origin', 'Request origin rejected'));
    if (!request.headers['content-type']?.startsWith('application/json'))
      return reply
        .code(415)
        .type('application/problem+json')
        .send(problem(415, 'factory-request', 'JSON required'));
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'factory-request',
            'A positive issue number and bounded context are required'
          )
        );
    const result: StartResult = await config.run(
      config.job.start({ ...parsed.data, base: config.base })
    );
    if (result.kind === 'occupied')
      return reply
        .code(409)
        .type('application/problem+json')
        .send(problem(409, 'factory-occupied', 'The single admission is already reserved'));
    if (result.kind === 'rejected')
      return reply
        .code(422)
        .type('application/problem+json')
        .send(problem(422, 'factory-admission', 'Issue is not eligible'));
    return reply.code(202).send(result);
  });
  return app;
}
