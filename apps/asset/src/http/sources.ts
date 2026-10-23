import { randomUUID } from 'node:crypto';
import { context as otelContext, propagation } from '@opentelemetry/api';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import { Effect } from 'effect';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AuthorAuthentication } from '../adapters/authors/index.js';
import {
  Sources,
  type Candidate,
  type SourcesPort,
  type SourceOutcome,
} from '../capabilities/sources/index.js';
import type { Owner } from '../capabilities/lifecycle/index.js';
export interface SourceExecution {
  run<A, E>(
    effect: Effect.Effect<A, E, AuthorAuthentication | Sources>,
    headers: IncomingHttpHeaders,
    signal?: AbortSignal
  ): Promise<A>;
}
const problem = (status: number, reason: string) => ({
  type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${reason}.md`,
  status,
  title: reason.replaceAll('-', ' '),
});
const intent = z
  .object({
    operation: z.enum(['add', 'replace-one', 'replace-set']),
    expectedSourceSetRevision: z.string().regex(/^(0|[1-9][0-9]{0,39})$/),
    targetSourceId: z.string().min(1).max(256).optional(),
  })
  .strict();
const mutationOptions = {
  schema: { body: zodToJsonSchema(intent) },
  // Zod owns this HTTP contract. Avoid AJV coercing numeric revisions or stripping forbidden fields.
  validatorCompiler: () => (value: unknown) => {
    const parsed = intent.safeParse(value);
    return parsed.success
      ? { value: parsed.data }
      : { error: new Error('Invalid candidate intent') };
  },
};
function requestContext(request: FastifyRequest) {
  const carrier: Record<string, string> = {};
  propagation.inject(propagation.extract(otelContext.active(), request.headers), carrier);
  const correlation = request.headers['x-correlation-id'];
  return {
    occurrence: { source: 'https://wallpaperdb/asset/authors', id: randomUUID() },
    ...(typeof correlation === 'string' &&
    Buffer.byteLength(correlation) > 0 &&
    Buffer.byteLength(correlation) <= 256
      ? { correlationId: correlation }
      : {}),
    ...(carrier.traceparent ? { traceparent: carrier.traceparent } : {}),
    ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
  };
}
function publicCandidate(candidate: Candidate) {
  return {
    candidateId: candidate.candidateId,
    status: candidate.status,
    operation: candidate.operation,
    expectedSourceSetRevision: candidate.expectedSourceSetRevision,
    ...(candidate.targetSourceId ? { targetSourceId: candidate.targetSourceId } : {}),
    ...(candidate.reason ? { reason: candidate.reason } : {}),
    ...(candidate.status === 'accepted'
      ? { sourceId: candidate.sourceId, sourceSetRevision: candidate.sourceSetRevision }
      : {}),
    expiresAt: candidate.expiresAt,
  };
}
function outcome(reply: FastifyReply, result: SourceOutcome, success = 200) {
  if (result.kind === 'unavailable')
    return reply.code(404).type('application/problem+json').send(problem(404, 'not-found'));
  if (result.kind === 'rejected') {
    const status =
      result.reason === 'encoded-size-limit'
        ? 413
        : /conflict|already-accepted|count-limit/.test(result.reason)
          ? 409
          : 422;
    return reply.code(status).type('application/problem+json').send(problem(status, result.reason));
  }
  return reply.code(success).send(publicCandidate(result.candidate));
}
export function registerSourceRoutes(app: FastifyInstance, execution: SourceExecution) {
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/asset-types/') || route.url.startsWith('/assets/'))
      route.schema = { tags: ['Sources'], security: [{ ownerSession: [] }], ...route.schema };
  });
  // Returning the raw stream avoids Fastify buffering an entire encoded image.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
    done(null, payload)
  );
  const run = async <A>(
    request: FastifyRequest,
    reply: FastifyReply,
    call: (sources: SourcesPort, owner: Owner) => Effect.Effect<A, unknown>,
    respond: (value: A) => unknown
  ) => {
    reply.header('Cache-Control', 'no-store');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      const result = await execution.run(
        Effect.gen(function* () {
          const auth = yield* AuthorAuthentication;
          const owner = yield* auth.verify(request.headers.authorization);
          if (!owner) return { kind: 'unauthorized' as const };
          const sources = yield* Sources;
          return { kind: 'result' as const, value: yield* call(sources, owner) };
        }).pipe(Effect.catch(() => Effect.succeed({ kind: 'failure' as const }))),
        request.headers,
        controller.signal
      );
      if (result.kind !== 'result') {
        const status = result.kind === 'unauthorized' ? 401 : 503;
        return reply
          .code(status)
          .type('application/problem+json')
          .send(problem(status, status === 401 ? 'unauthorized' : 'service-unavailable'));
      }
      return await respond(result.value);
    } finally {
      request.raw.off('aborted', abort);
      // A streamed original retains request cancellation until its response finishes.
      if (!reply.sent) reply.raw.off('close', abort);
    }
  };
  app.get<{ Params: { type: string } }>('/asset-types/:type/policy', (request, reply) =>
    run(
      request,
      reply,
      (sources, owner) => sources.policy(owner, request.params.type),
      (result) =>
        result.kind === 'policy'
          ? reply.send({ policy: result.policy, revision: result.revision })
          : reply.code(404).type('application/problem+json').send(problem(404, 'not-found'))
    )
  );
  app.get<{ Params: { assetId: string } }>('/assets/:assetId/sources', (request, reply) =>
    run(
      request,
      reply,
      (sources, owner) => sources.list(owner, request.params.assetId),
      (result) =>
        result.kind === 'found'
          ? reply.send({
              ...result.asset,
              sources: result.asset.sources.map(({ sourceId, facts }) => ({ sourceId, facts })),
              candidates: result.asset.candidates.map(publicCandidate),
            })
          : reply.code(404).type('application/problem+json').send(problem(404, 'not-found'))
    )
  );
  app.post<{ Params: { assetId: string } }>(
    '/assets/:assetId/source-candidates',
    mutationOptions,
    (request, reply) => {
      const body = intent.safeParse(request.body);
      const key = z
        .string()
        .regex(/^[\x21-\x7e]{1,128}$/)
        .safeParse(request.headers['idempotency-key']);
      if (!body.success || !key.success)
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'invalid-request'));
      return run(
        request,
        reply,
        (sources, owner) =>
          sources.create(owner, request.params.assetId, {
            ...body.data,
            idempotencyKey: key.data,
            context: requestContext(request),
          }),
        (result) => {
          if (result.kind === 'candidate')
            reply.header(
              'Location',
              `/assets/${encodeURIComponent(request.params.assetId)}/source-candidates/${encodeURIComponent(result.candidate.candidateId)}`
            );
          return outcome(reply, result, 201);
        }
      );
    }
  );
  app.get<{ Params: { assetId: string; candidateId: string } }>(
    '/assets/:assetId/source-candidates/:candidateId',
    (request, reply) =>
      run(
        request,
        reply,
        (sources, owner) =>
          sources.status(owner, request.params.assetId, request.params.candidateId),
        (result) => outcome(reply, result)
      )
  );
  app.delete<{ Params: { assetId: string; candidateId: string } }>(
    '/assets/:assetId/source-candidates/:candidateId',
    (request, reply) =>
      run(
        request,
        reply,
        (sources, owner) =>
          sources.cancel(owner, request.params.assetId, request.params.candidateId),
        (result) => outcome(reply, result)
      )
  );
  app.put<{ Params: { assetId: string; candidateId: string } }>(
    '/assets/:assetId/source-candidates/:candidateId/bytes',
    (request, reply) => {
      if (!(request.body instanceof Readable))
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'invalid-request'));
      const body = request.body;
      return run(
        request,
        reply,
        (sources, owner) =>
          sources.upload(
            owner,
            request.params.assetId,
            request.params.candidateId,
            Object.assign(body.iterator({ destroyOnReturn: false }), {
              cancel: () => {
                body.destroy();
              },
            })
          ),
        (result) => {
          if (!body.readableEnded) {
            reply.header('Connection', 'close');
            reply.raw.once('finish', () => body.destroy());
          }
          return outcome(reply, result);
        }
      );
    }
  );
  app.post<{ Params: { assetId: string; candidateId: string } }>(
    '/assets/:assetId/source-candidates/:candidateId/accept',
    mutationOptions,
    (request, reply) => {
      const body = intent.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'invalid-request'));
      return run(
        request,
        reply,
        (sources, owner) =>
          sources.accept(owner, request.params.assetId, request.params.candidateId, {
            ...body.data,
            context: requestContext(request),
          }),
        (result) =>
          outcome(
            reply,
            result,
            result.kind === 'candidate' &&
              ['accepting', 'inspecting'].includes(result.candidate.status)
              ? 202
              : 200
          )
      );
    }
  );
  app.get<{ Params: { assetId: string; sourceId: string } }>(
    '/assets/:assetId/sources/:sourceId/original',
    (request, reply) =>
      run(
        request,
        reply,
        (sources, owner) =>
          sources.original(owner, request.params.assetId, request.params.sourceId),
        (result) => {
          if (result.kind === 'unavailable')
            return reply.code(404).type('application/problem+json').send(problem(404, 'not-found'));
          const body = Readable.from(result.bytes);
          const close = () => {
            body.destroy();
            void execution.run(result.close(), request.headers).catch(() => undefined);
          };
          reply.raw.once('close', close);
          reply.raw.once('finish', close);
          return reply
            .type(result.facts.mimeType)
            .header('Content-Length', result.facts.byteLength)
            .header(
              'Content-Disposition',
              `attachment; filename="${request.params.sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}.${result.facts.mimeType === 'image/jpeg' ? 'jpg' : result.facts.mimeType.split('/')[1]}"`
            )
            .send(body);
        }
      )
  );
}
