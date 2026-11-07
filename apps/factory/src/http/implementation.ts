import Fastify, { type FastifyRequest } from 'fastify';
import { Effect, type Tracer } from 'effect';
import { z } from 'zod';
import { Unavailable, type Job, type StartResult } from '../capabilities/job/index.js';
import type { Plan, Scheduler } from '../capabilities/plan/index.js';
import { registerV2Routes, type V2Data } from './v2/server.js';
import { serveAssets } from './assets.js';
import type { WorkRelationship } from './contract.js';
import { requestOperation } from './tracing.js';
const startSchema = z
  .object({ issue: z.number().int().positive().safe(), context: z.string().max(16000).default('') })
  .strict();
export function operationsServer(config: {
  clientActivity?: () => () => void;
  v2?: V2Data;
  threads?: () => Effect.Effect<
    import('../capabilities/observe/index.js').ThreadSnapshot,
    Unavailable
  >;
  base: string;
  run: <A>(
    effect: import('effect').Effect.Effect<A, import('../capabilities/job/index.js').Unavailable>
  ) => Promise<A>;
  job: Job;
  snapshot?: () => Effect.Effect<
    import('../capabilities/observe/index.js').ScheduleSnapshot,
    Unavailable
  >;
  plan?: Plan;
  scheduler?: Scheduler;
  attempts?: {
    submit(
      parent?: Tracer.Span
    ): Promise<import('../capabilities/plan/index.js').AttemptSubmission>;
    observe(id: string, parent?: Tracer.Span): Promise<unknown | undefined>;
  };
  relationships?: (
    issues: readonly number[]
  ) => Effect.Effect<readonly WorkRelationship[], Unavailable>;
}) {
  const app = Fastify({ bodyLimit: 20000 });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const release = config.clientActivity?.();
    if (!release) return;
    const finish = () => {
      reply.raw.off('finish', finish);
      reply.raw.off('close', finish);
      release();
    };
    reply.raw.once('finish', finish);
    reply.raw.once('close', finish);
  });
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
  const execute = <A>(
    request: FastifyRequest,
    name: string,
    operation: Effect.Effect<A, Unavailable>
  ) => config.run(requestOperation(request.headers, name, operation));
  const schedulerStatus = async (request: FastifyRequest) => {
    if (config.snapshot) return execute(request, 'factory.http.snapshot', config.snapshot());
    if (!config.scheduler) return undefined;
    const snapshot = await execute(
      request,
      'factory.http.scheduler.status',
      config.scheduler.status()
    );
    const relationships = config.relationships
      ? await execute(
          request,
          'factory.http.relationships',
          config.relationships(snapshot.state.admissions.map((admission) => admission.issue))
        )
      : undefined;
    return { ...snapshot, relationships };
  };
  app.post('/api/plan', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== `${request.protocol}://${request.headers.host}`)
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'factory-origin', 'Request origin rejected'));
    if (!config.plan && !config.attempts)
      return reply
        .code(503)
        .type('application/problem+json')
        .send(problem(503, 'factory-unavailable', 'Plan preview unavailable'));
    if (!z.object({}).strict().safeParse(request.body).success)
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'factory-request', 'Preview accepts no overrides'));
    if (config.attempts) {
      const attempts = config.attempts;
      const result = await execute(
        request,
        'factory.http.plan.submit',
        Effect.gen(function* () {
          const parent = yield* Effect.currentSpan.pipe(
            Effect.catch(() => Effect.succeed(undefined))
          );
          return yield* Effect.tryPromise({
            try: () => attempts.submit(parent),
            catch: (cause) =>
              cause instanceof Unavailable
                ? cause
                : new Unavailable({ operation: 'planning-submission', cause }),
          });
        })
      );
      if (result.kind === 'conflict')
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'factory-plan-conflict',
              'Planner ownership changed during submission. Refresh before retrying.'
            )
          );
      if (result.kind === 'blocked')
        return reply
          .code(409)
          .type('application/problem+json')
          .send({
            ...problem(
              409,
              'factory-plan-ownership',
              result.reason === 'reconciliation-required'
                ? 'Unbound planner launch requires operator reconciliation'
                : 'Previous bound planner is outstanding'
            ),
            requestId: result.requestId,
            reason: result.reason,
          });
      if (result.kind === 'busy')
        return reply
          .code(409)
          .type('application/problem+json')
          .send({
            ...problem(
              409,
              'factory-plan-busy',
              'Planner attempt is outstanding; observe before retrying'
            ),
            attemptId: result.id,
          });
      return reply.code(202).header('location', `/api/plan/${result.id}`).send(result);
    }
    if (config.plan) return execute(request, 'factory.http.plan', config.plan.preview());
    return reply
      .code(503)
      .type('application/problem+json')
      .send(problem(503, 'factory-unavailable', 'Plan preview unavailable'));
  });
  app.get('/api/plan/:id', async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const attempts = config.attempts;
    const result =
      parsed.success && attempts
        ? await execute(
            request,
            'factory.http.plan.observe',
            Effect.gen(function* () {
              const parent = yield* Effect.currentSpan.pipe(
                Effect.catch(() => Effect.succeed(undefined))
              );
              return yield* Effect.tryPromise({
                try: () => attempts.observe(parsed.data.id, parent),
                catch: (cause) =>
                  cause instanceof Unavailable
                    ? cause
                    : new Unavailable({ operation: 'planning-observation', cause }),
              });
            })
          )
        : undefined;
    if (!result)
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'factory-plan-missing', 'Planner attempt not found'));
    return result;
  });
  if (config.scheduler) {
    const scheduler = config.scheduler;
    app.get('/api/scheduler', schedulerStatus);
    app.post('/api/scheduler', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && origin !== `${request.protocol}://${request.headers.host}`)
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'factory-origin', 'Request origin rejected'));
      const limit = z
        .number()
        .int()
        .safe()
        .refine((v) => v === -1 || v > 0);
      const parsed = z
        .object({
          revision: z.number().int().min(-1),
          concurrency: limit,
          allowance: limit,
          paused: z.boolean(),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(400, 'factory-request', 'Positive limits or -1 and current revision required')
          );
      const result = await execute(
        request,
        'factory.http.scheduler.configure',
        scheduler.configure(parsed.data)
      );
      if (result !== 'saved')
        return reply
          .code(result === 'conflict' ? 409 : 422)
          .type('application/problem+json')
          .send(
            problem(
              result === 'conflict' ? 409 : 422,
              'factory-command',
              'Controls changed or limits invalid. Refresh observation.'
            )
          );
      return schedulerStatus(request);
    });
  }
  if (config.v2) {
    const data = config.v2;
    app.register(async (instance) => {
      registerV2Routes(instance, data);
    });
  }
  app.get('/health', () => ({ status: 'ok' }));
  app.get('/api/threads', (request) =>
    config.threads
      ? execute(request, 'factory.http.threads', config.threads())
      : { state: 'initial', stale: false }
  );
  app.get('/api/observations', (request) =>
    config.snapshot
      ? execute(
          request,
          'factory.http.observations',
          Effect.map(config.snapshot(), (s) => s.observations)
        )
      : {}
  );
  app.get('/api/job', async (request) =>
    config.snapshot
      ? ((await schedulerStatus(request))?.jobs[0] ?? { kind: 'empty' })
      : execute(request, 'factory.http.status', config.job.status())
  );
  serveAssets(app);
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
    const result: StartResult = await execute(
      request,
      'factory.http.start',
      config.job.start({ ...parsed.data, base: config.base })
    );
    if (result.kind === 'occupied')
      return reply
        .code(409)
        .type('application/problem+json')
        .send(
          problem(
            409,
            'factory-occupied',
            'Admission paused, capacity full, or issue already reserved'
          )
        );
    if (result.kind === 'rejected')
      return reply
        .code(422)
        .type('application/problem+json')
        .send(problem(422, 'factory-admission', 'Issue is not eligible'));
    return reply.code(202).send(result);
  });
  const resumeSchema = z.union([
    z
      .object({
        jobId: z.string().min(1),
        index: z.number().int().nonnegative(),
        questionId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        jobId: z.string().min(1),
        index: z.number().int().nonnegative(),
        runId: z.string().min(1),
        revision: z.number().int().min(-1),
      })
      .strict(),
  ]);
  const cancelSchema = z.object({ jobId: z.string().min(1) }).strict();
  for (const action of ['resume', 'cancel'] as const) {
    app.post(`/api/job/${action}`, async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && origin !== `${request.protocol}://${request.headers.host}`)
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'factory-origin', 'Request origin rejected'));
      const parsed =
        action === 'resume'
          ? resumeSchema.safeParse(request.body)
          : cancelSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'factory-request', 'Invalid job command'));
      const operation =
        action === 'resume'
          ? config.job.resume(resumeSchema.parse(parsed.data))
          : config.job.cancel(parsed.data.jobId);
      const result = await execute(request, `factory.http.${action}`, operation);
      if (result.kind === 'rejected' || result.kind === 'occupied')
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'factory-command',
              'Job changed or command is unavailable. Refresh observation.'
            )
          );
      return reply.code(202).send(result);
    });
  }
  return app;
}
