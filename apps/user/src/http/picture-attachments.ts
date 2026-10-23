import { Effect, type Layer, ManagedRuntime } from 'effect';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AttachmentHealth,
  PictureAttachments,
  type AttachmentOutcome,
  type PictureAttachment,
} from '../capabilities/picture-attachments/index.js';
import type { ProfilePrincipal } from '../capabilities/profile/index.js';
import { problem } from './problem.js';
const identity = z
  .string()
  .min(1)
  .refine((s) => new TextEncoder().encode(s).length <= 256);
const firstSource = z.object({ candidateId: identity, intentId: identity }).strict();
const start = z.object({ expectedVersion: z.number().int().positive().safe() }).strict();
function options(schema: z.ZodTypeAny) {
  return {
    schema: { body: zodToJsonSchema(schema, { $refStrategy: 'none' }), tags: ['Profile pictures'] },
    validatorCompiler: () => (value: unknown) => {
      const result = schema.safeParse(value);
      return result.success
        ? { value: result.data }
        : { error: new Error('Invalid attachment command') };
    },
  };
}
function publicAttachment(i: PictureAttachment) {
  return {
    attachmentId: i.id,
    state: i.state,
    assetId: i.assetId,
    sourceId: i.sourceId,
    createdAt: i.createdAt,
    deletion: i.deletion,
    ...(i.sourceIntent ? { candidateId: i.sourceIntent.candidateId } : {}),
    ...(i.attentionRequired ? { attentionRequired: true } : {}),
  };
}
function respond(reply: FastifyReply, outcome: AttachmentOutcome, accepted: boolean) {
  if (outcome.kind === 'attachment')
    return reply
      .code(accepted && outcome.attachment.state !== 'attached' ? 202 : 200)
      .send(publicAttachment(outcome.attachment));
  const status = outcome.kind === 'unavailable' ? 404 : outcome.kind === 'forbidden' ? 403 : 409;
  return reply
    .code(status)
    .type('application/problem+json')
    .send(
      problem(status, outcome.kind === 'unavailable' ? 'not-found' : outcome.kind, outcome.kind)
    );
}
/** Registered Source intent precedes Author acceptance. Poll until User reports
 * attached; Asset's independent accepted response never completes this workflow. */
export async function registerAttachmentHttp<E>(
  app: FastifyInstance,
  services: Layer.Layer<PictureAttachments | AttachmentHealth, E>,
  monitor = false
) {
  const runtime = ManagedRuntime.make(services);
  await runtime.runPromise(PictureAttachments).catch(async (error) => {
    await runtime.dispose();
    throw error;
  });
  const controllers = new Set<AbortController>();
  let closing: ReturnType<typeof setTimeout> | undefined;
  app.addHook('preClose', async () => {
    closing = setTimeout(() => {
      for (const c of controllers) c.abort();
    }, 5000);
    closing.unref();
  });
  app.addHook('onClose', async () => {
    clearTimeout(closing);
    for (const c of controllers) c.abort();
    await runtime.dispose();
  });
  if (monitor)
    app.addHook('onRequest', async (request, reply) => {
      if (request.url !== '/ready' && request.url !== '/health') return;
      if (!(await runtime.runPromise(AttachmentHealth.use((s) => s.check()))))
        return reply
          .code(503)
          .type('application/problem+json')
          .send(problem(503, 'picture-workflow-unavailable', 'Picture workflow unavailable'));
    });
  const run = async (
    request: FastifyRequest,
    reply: FastifyReply,
    call: (s: PictureAttachments, p: ProfilePrincipal) => Effect.Effect<AttachmentOutcome, unknown>,
    accepted = false
  ) => {
    reply.header('Cache-Control', 'no-store');
    const principal = request.profilePrincipal;
    if (!principal)
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'unauthorized', 'Unauthorized'));
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      const parent = trace.getSpanContext(propagation.extract(context.active(), request.headers));
      const operation = PictureAttachments.use((s) => call(s, principal)).pipe(
        Effect.map((result) => ({ kind: 'result' as const, result })),
        Effect.catch(() => Effect.succeed({ kind: 'failure' as const }))
      );
      const result = await runtime.runPromise(
        parent ? OtelTracer.withSpanContext(operation, parent) : operation,
        { signal: controller.signal }
      );
      return result.kind === 'result'
        ? respond(reply, result.result, accepted)
        : reply
            .code(503)
            .type('application/problem+json')
            .send(problem(503, 'picture-workflow-unavailable', 'Picture workflow unavailable'));
    } finally {
      controllers.delete(controller);
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  };
  app.post('/profile/me/picture-attachments', options(start), (request, reply) => {
    const key = z
      .string()
      .regex(/^[\x21-\x7e]{1,128}$/)
      .safeParse(request.headers['idempotency-key']);
    const body = start.safeParse(request.body);
    if (!key.success || !body.success)
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'invalid-picture-command', 'Invalid picture command'));
    const carrier: Record<string, string> = {};
    propagation.inject(propagation.extract(context.active(), request.headers), carrier);
    return run(
      request,
      reply,
      (s, p) =>
        s.begin(p, key.data, body.data.expectedVersion, {
          ...(carrier.traceparent ? { traceparent: carrier.traceparent } : {}),
          ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
        }),
      true
    );
  });
  app.get<{ Params: { attachmentId: string } }>(
    '/profile/me/picture-attachments/:attachmentId',
    (request, reply) => run(request, reply, (s, p) => s.get(p, request.params.attachmentId))
  );
  app.put<{ Params: { attachmentId: string } }>(
    '/profile/me/picture-attachments/:attachmentId/first-source',
    options(firstSource),
    (request, reply) => {
      const body = firstSource.parse(request.body);
      return run(
        request,
        reply,
        (s, p) => s.expectSource(p, request.params.attachmentId, body),
        true
      );
    }
  );
  app.delete<{ Params: { attachmentId: string } }>(
    '/profile/me/picture-attachments/:attachmentId',
    (request, reply) => run(request, reply, (s, p) => s.cancel(p, request.params.attachmentId))
  );
}
