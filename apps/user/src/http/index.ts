import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Context, Effect, FiberSet, Layer, ManagedRuntime } from 'effect';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Availability } from '../availability/index.js';
import {
  Profiles,
  type ProfileOutcome,
  type ProfilePrincipal,
  type RejectionReason,
} from '../profile/index.js';
import { registerUserCors } from './cors.js';

export interface HttpConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly clerkSecretKey?: string;
}
export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
  }
  interface FastifyRequest {
    profilePrincipal: ProfilePrincipal | null;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}
export function problem(status: number, name: string, title: string, detail?: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
    ...(detail ? { detail } : {}),
  };
}
type HttpServices = Profiles | Availability;
interface Execution {
  run<A, E>(
    effect: Effect.Effect<A, E, HttpServices>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<A>;
}
const Execution = Context.Service<Execution>('wallpaperdb.user.http.Execution');
const executionLayer = Layer.effect(
  Execution,
  Effect.gen(function* () {
    yield* Profiles;
    yield* Availability;
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

const testIdentity = z.object({ id: z.string().min(1) });
async function registerAuthentication(app: FastifyInstance, config: HttpConfig) {
  app.decorateRequest('profilePrincipal', null);
  const clerk = config.nodeEnv === 'test' ? null : await import('@clerk/fastify');
  if (clerk) await app.register(clerk.clerkPlugin, { secretKey: config.clerkSecretKey });
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.skipAuth) return;
    let profileId: string | null = null;
    if (clerk) profileId = clerk.getAuth(request).userId;
    else {
      const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
      if (match) {
        try {
          profileId = testIdentity.parse(
            JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
          ).id;
        } catch {
          /* A malformed test token is unauthenticated. */
        }
      }
    }
    if (!profileId)
      return reply
        .code(401)
        .type('application/problem+json')
        .send(
          problem(
            401,
            'unauthorized',
            'Unauthorized',
            'Authentication is required to access this resource.'
          )
        );
    request.profilePrincipal = { profileId };
  });
}
const rejectionStatus: Record<RejectionReason, number> = {
  unauthorized: 401,
  'invalid-display-name': 400,
  'invalid-biography': 400,
  'unavailable-biography-wallpaper': 400,
  'invalid-handle': 400,
  'invalid-alias-command': 400,
  'ineligible-handle': 400,
  'alias-limit': 409,
  'alias-not-found': 404,
  'alias-not-scheduled': 409,
  'handle-unavailable': 409,
  'handle-cooldown': 429,
  'version-conflict': 409,
  'picture-unavailable': 400,
};
function sendProfile(reply: FastifyReply, outcome: ProfileOutcome) {
  if (outcome._tag === 'Success') return reply.send(outcome.profile);
  const status = rejectionStatus[outcome.reason];
  return reply
    .code(status)
    .type('application/problem+json')
    .send({
      ...problem(
        status,
        outcome.reason === 'version-conflict' ? 'profile-version-conflict' : outcome.reason,
        'Profile command rejected',
        outcome.message
      ),
      ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
      ...(outcome.nextHandleChangeAt
        ? { nextHandleChangeAt: outcome.nextHandleChangeAt.toISOString() }
        : {}),
    });
}
function profileCommand(
  execution: Execution,
  operation: (
    profiles: Profiles,
    principal: ProfilePrincipal
  ) => Effect.Effect<ProfileOutcome, import('../profile/index.js').ProfileUnavailable>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = request.profilePrincipal;
    if (!principal)
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'unauthorized', 'Unauthorized'));
    return execution.run(
      Profiles.use((profiles) => operation(profiles, principal)).pipe(
        Effect.match({
          onSuccess: (result) => sendProfile(reply, result),
          onFailure: (failure) =>
            reply
              .code(503)
              .type('application/problem+json')
              .send(
                problem(
                  503,
                  failure.operation === 'identity' ? 'identity-unavailable' : 'profile-unavailable',
                  'Profile service unavailable'
                )
              ),
        })
      ),
      request,
      reply
    );
  };
}

export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<HttpServices, E>,
  options: {
    readonly logger?: boolean;
    readonly signal?: AbortSignal;
    readonly shutdownTimeoutMs?: number;
  } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(executionLayer.pipe(Layer.provide(services)));
  const app = Fastify({
    logger: options.logger ?? false,
    forceCloseConnections: 'idle',
    requestTimeout: 15000,
    connectionTimeout: 15000,
  });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposing: Promise<void> | undefined;
  const dispose = () => (disposing ??= runtime.dispose());
  app.addHook('preClose', async () => {
    app.connectionsState.isShuttingDown = true;
    deadline = setTimeout(() => {
      app.server.closeAllConnections();
      void dispose();
    }, options.shutdownTimeoutMs ?? 5000);
    deadline.unref();
  });
  app.addHook('onClose', async () => {
    clearTimeout(deadline);
    await dispose();
  });
  app.setErrorHandler((error, request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const status =
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500 &&
      Object.hasOwn(Fastify.errorCodes, error.code)
        ? error.statusCode
        : 500;
    if (status === 500) request.log.error({ err: error }, 'User request failed');
    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(
          status,
          status === 500 ? 'generic-server' : 'invalid-request',
          status === 500 ? 'Internal server error' : 'Invalid request'
        )
      );
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send(problem(404, 'not-found', 'Not found'))
  );
  try {
    const execution = await runtime.runPromise(Execution, { signal: options.signal });
    await registerUserCors(app, config.nodeEnv);
    await registerAuthentication(app, config);
    await registerOpenAPI(app, {
      title: 'WallpaperDB User API',
      version: '1.0.0',
      description: 'Profile commands and current picture availability.',
    });
    app.post(
      '/profile/me/ensure',
      profileCommand(execution, (profiles, principal) => profiles.ensure(principal))
    );
    app.get('/health', { config: { skipAuth: true } }, (request, reply) =>
      execution.run(
        Availability.use((service) => service.health(app.connectionsState.isShuttingDown)).pipe(
          Effect.map((result) =>
            result.status === 'healthy'
              ? reply.send(result)
              : reply
                  .code(503)
                  .type('application/problem+json')
                  .send({
                    ...result,
                    ...problem(503, 'service-unavailable', 'Service unavailable'),
                    healthStatus: result.status,
                  })
          )
        ),
        request,
        reply
      )
    );
    app.get('/ready', { config: { skipAuth: true } }, (request, reply) =>
      execution.run(
        Availability.use((service) =>
          service.ready(
            app.connectionsState.isShuttingDown,
            app.connectionsState.connectionsInitialized
          )
        ).pipe(
          Effect.map((result) =>
            result.ready
              ? reply.send(result)
              : reply
                  .code(503)
                  .type('application/problem+json')
                  .send({
                    ...result,
                    ...problem(503, 'service-unavailable', 'Service unavailable'),
                  })
          )
        ),
        request,
        reply
      )
    );
    app.connectionsState.connectionsInitialized = true;
    return app;
  } catch (error) {
    await app.close();
    await dispose();
    throw error;
  }
}
