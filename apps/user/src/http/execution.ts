import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Context, Effect, FiberSet, Layer } from 'effect';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Profiles } from '../profile/index.js';
import { Availability } from '../availability/index.js';
import { Pictures } from '../pictures/index.js';
export type HttpServices = Profiles | Pictures | Availability;
export interface Execution {
  run<A, E>(
    effect: Effect.Effect<A, E, HttpServices>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<A>;
}
export const Execution = Context.Service<Execution>('wallpaperdb.user.http.Execution');
export const executionLayer = Layer.effect(
  Execution,
  Effect.gen(function* () {
    yield* Profiles;
    yield* Availability;
    yield* Pictures;
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(fibers)<HttpServices>();
    return Execution.of({
      run: async (effect, request, reply) => {
        const active = context.active();
        const parent = (
          trace.getSpan(active) ?? trace.getSpan(propagation.extract(active, request.headers))
        )?.spanContext();
        const controller = new AbortController();
        const abort = () => {
          if (!reply.raw.writableEnded) controller.abort();
        };
        reply.raw.once('close', abort);
        try {
          return await run(parent ? OtelTracer.withSpanContext(effect, parent) : effect, {
            signal: controller.signal,
          });
        } finally {
          reply.raw.removeListener('close', abort);
        }
      },
    });
  })
);
