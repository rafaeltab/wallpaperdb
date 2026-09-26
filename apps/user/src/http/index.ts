import { Execution, executionLayer, type HttpServices } from './execution.js';
import { registerProfileRoutes } from './profile.js';
import { registerPictureRoutes } from './pictures.js';
import { problem } from './problem.js';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { Effect, Layer, ManagedRuntime } from 'effect';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Availability } from '../availability/index.js';
import type { ProfilePrincipal } from '../profile/index.js';
import { registerUserCors } from './cors.js';

export interface HttpConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly clerkSecretKey?: string;
  readonly profilePictureMaxBytes?: number;
  readonly userMediaServiceToken?: string;
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
    const transport = z
      .object({ statusCode: z.number().int().min(400).max(499), code: z.string() })
      .safeParse(error);
    const status =
      transport.success &&
      (Object.hasOwn(Fastify.errorCodes, transport.data.code) ||
        [
          'FST_REQ_FILE_TOO_LARGE',
          'FST_FILES_LIMIT',
          'FST_FIELDS_LIMIT',
          'FST_PARTS_LIMIT',
          'FST_INVALID_MULTIPART_CONTENT_TYPE',
        ].includes(transport.data.code))
        ? transport.data.statusCode
        : 500;
    const oversized = transport.success && transport.data.code === 'FST_REQ_FILE_TOO_LARGE';
    if (status === 500) request.log.error({ err: error }, 'User request failed');
    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(
          status,
          oversized ? 'picture-too-large' : status === 500 ? 'generic-server' : 'invalid-request',
          oversized
            ? 'Picture too large'
            : status === 500
              ? 'Internal server error'
              : 'Invalid request',
          oversized ? 'Picture exceeds the upload byte limit' : undefined
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
    registerProfileRoutes(app, execution);
    await registerPictureRoutes(app, execution, config);
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
