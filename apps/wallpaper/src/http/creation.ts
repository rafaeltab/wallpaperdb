import { Effect, type Layer, ManagedRuntime } from 'effect';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  Creation,
  WorkflowHealth,
  type Wallpaper,
  CreatorAuthentication,
  type WallpaperOutcome,
} from '../capabilities/creation/index.js';
const problem = (status: number, reason: string) => ({
  status,
  title: reason.replaceAll('-', ' '),
  type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${reason}.md`,
});
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sourceIntent = z.object({ candidateId: identity, intentId: identity }).strict();
function schemaOptions(schema: z.ZodTypeAny) {
  return {
    schema: { body: zodToJsonSchema(schema, { $refStrategy: 'none' }) },
    validatorCompiler: () => (value: unknown) => {
      const result = schema.safeParse(value);
      return result.success ? { value: result.data } : { error: new Error('Invalid request') };
    },
  };
}
function respond(reply: FastifyReply, result: WallpaperOutcome, accepted = false) {
  if (result.kind !== 'wallpaper') {
    const status = result.kind === 'unavailable' ? 404 : result.kind === 'forbidden' ? 403 : 409;
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, result.kind === 'unavailable' ? 'not-found' : result.kind));
  }
  return reply.code(accepted ? 202 : 200).send(publicWallpaper(result.wallpaper));
}
function publicWallpaper(w: Wallpaper) {
  return {
    wallpaperId: w.id,
    state: w.state,
    assetId: w.assetId,
    sourceId: w.sourceId,
    createdAt: w.createdAt,
    ...(w.intent ? { candidateId: w.intent.candidateId } : {}),
    ...(w.attentionRequired ? { attentionRequired: true } : {}),
  };
}
export async function registerCreationHttp<E>(
  app: FastifyInstance,
  services: Layer.Layer<Creation | CreatorAuthentication | WorkflowHealth, E>,
  options: { readonly monitorWorkflow?: boolean } = {}
) {
  const runtime = ManagedRuntime.make(services);
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/wallpapers'))
      route.schema = { tags: ['Wallpapers'], security: [{ ownerSession: [] }], ...route.schema };
  });
  await runtime.runPromise(Creation).catch(async (error) => {
    await runtime.dispose();
    throw error;
  });
  if (options.monitorWorkflow)
    app.addHook('onRequest', async (request, reply) => {
      if (request.url !== '/ready' && request.url !== '/health') return;
      const healthy = await runtime.runPromise(WorkflowHealth.use((service) => service.check()));
      if (!healthy)
        return reply
          .code(503)
          .type('application/problem+json')
          .send(problem(503, 'service-unavailable'));
    });
  const controllers = new Set<AbortController>();
  let closing: ReturnType<typeof setTimeout> | undefined;
  app.addHook('preClose', async () => {
    closing = setTimeout(() => {
      for (const controller of controllers) controller.abort();
    }, 5000);
    closing.unref();
  });
  app.addHook('onClose', async () => {
    clearTimeout(closing);
    for (const controller of controllers) controller.abort();
    await runtime.dispose();
  });
  const run = async (
    request: FastifyRequest,
    reply: FastifyReply,
    call: (
      creation: Creation['Service'],
      owner: { namespace: string; subject: string }
    ) => Effect.Effect<WallpaperOutcome, unknown>,
    accepted = false
  ) => {
    reply.header('Cache-Control', 'no-store');
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      const parent = trace
        .getSpan(propagation.extract(context.active(), request.headers))
        ?.spanContext();
      const operation = Effect.gen(function* () {
        const auth = yield* CreatorAuthentication;
        const owner = yield* auth.verify(request.headers.authorization);
        if (!owner) return { kind: 'unauthorized' as const };
        const c = yield* Creation;
        return { kind: 'result' as const, value: yield* call(c, owner) };
      }).pipe(Effect.catch(() => Effect.succeed({ kind: 'failure' as const })));
      const result = await runtime.runPromise(
        parent ? OtelTracer.withSpanContext(operation, parent) : operation,
        { signal: controller.signal }
      );
      if (result.kind === 'result') return respond(reply, result.value, accepted);
      const status = result.kind === 'unauthorized' ? 401 : 503;
      return reply
        .code(status)
        .type('application/problem+json')
        .send(problem(status, status === 401 ? 'unauthorized' : 'service-unavailable'));
    } finally {
      controllers.delete(controller);
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  };
  app.get('/wallpapers', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const auth = yield* CreatorAuthentication;
        const owner = yield* auth.verify(request.headers.authorization);
        if (!owner) return { kind: 'unauthorized' as const };
        const c = yield* Creation;
        return { kind: 'list' as const, wallpapers: yield* c.list(owner) };
      }).pipe(Effect.catch(() => Effect.succeed({ kind: 'failure' as const })))
    );
    if (result.kind === 'list') return { wallpapers: result.wallpapers.map(publicWallpaper) };
    const status = result.kind === 'unauthorized' ? 401 : 503;
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, status === 401 ? 'unauthorized' : 'service-unavailable'));
  });
  app.post('/wallpapers', schemaOptions(z.object({}).strict()), (request, reply) => {
    const key = z
      .string()
      .regex(/^[\x21-\x7e]{1,128}$/)
      .safeParse(request.headers['idempotency-key']);
    if (!key.success)
      return reply.code(400).type('application/problem+json').send(problem(400, 'invalid-request'));
    const carrier: Record<string, string> = {};
    propagation.inject(propagation.extract(context.active(), request.headers), carrier);
    return run(
      request,
      reply,
      (c, owner) =>
        c.begin(owner, key.data, {
          ...(carrier.traceparent ? { traceparent: carrier.traceparent } : {}),
          ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
        }),
      true
    );
  });
  app.get<{ Params: { wallpaperId: string } }>('/wallpapers/:wallpaperId', (request, reply) =>
    run(request, reply, (c, owner) => c.get(owner, request.params.wallpaperId))
  );
  app.put<{ Params: { wallpaperId: string } }>(
    '/wallpapers/:wallpaperId/first-source',
    schemaOptions(sourceIntent),
    (request, reply) => {
      const parsed = sourceIntent.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'invalid-request'));
      return run(
        request,
        reply,
        (c, owner) => c.expectSource(owner, request.params.wallpaperId, parsed.data),
        true
      );
    }
  );
}
