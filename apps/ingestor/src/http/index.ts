import { observeUpload } from './telemetry.js';
import { installRequestLifecycle } from './lifecycle.js';
import cors from '@fastify/cors';
import { Availability } from '../availability/index.js';
import { installOpenApi, uploadSchema } from './openapi.js';
import { problem, sendProblem, sendUpload } from './problems.js';
import multipart from '@fastify/multipart';
import { Admission } from '../admission/index.js';
import { Ingestion } from '../ingestion/index.js';
import { clerkPlugin, getAuth } from '@clerk/fastify';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { HttpExecution, httpExecutionLayer, type HttpServices } from '../runtime.js';

export interface HttpConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly rateLimitMax: number;
  readonly clerkSecretKey?: string;
  readonly clerkPublishableKey?: string;
  readonly requestTimeoutMs?: number;
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
    ingestorProfileId?: string;
    ingestorSignal?: AbortSignal;
  }
}
const principalSchema = Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) });
function testProfile(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    return Schema.decodeUnknownSync(principalSchema)(
      JSON.parse(Buffer.from(header.slice(7), 'base64').toString('utf8'))
    ).id;
  } catch {
    return undefined;
  }
}
export async function createHttpApp<E>(
  config: HttpConfig,
  services: Layer.Layer<HttpServices, E>,
  options: { logger?: boolean; signal?: AbortSignal; shutdownTimeoutMs?: number } = {}
): Promise<FastifyInstance> {
  const runtime = ManagedRuntime.make(httpExecutionLayer.pipe(Layer.provide(services)));
  const requestTimeout = config.requestTimeoutMs ?? 120_000;
  const app = Fastify({
    logger: options.logger ?? false,
    forceCloseConnections: 'idle',
    requestTimeout,
    connectionTimeout: requestTimeout,
  });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  app.addHook('onClose', () => runtime.dispose());
  app.setNotFoundHandler((_request, reply) => sendProblem(reply, 404, 'not-found', 'Not found'));
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    request.log.error({ err: error }, 'Ingestor request failed');
    return sendProblem(
      reply,
      status,
      status === 500 ? 'generic-server' : 'invalid-request',
      status === 500 ? 'Internal server error' : 'Invalid request'
    );
  });
  try {
    const execution = await runtime.runPromise(HttpExecution, { signal: options.signal });
    const requests = installRequestLifecycle(app);
    app.addHook('preClose', async () => {
      app.connectionsState.isShuttingDown = true;
      await runtime.runPromise(
        requests.drain(options.shutdownTimeoutMs ?? 5000).pipe(Effect.andThen(execution.drain(0)))
      );
    });
    await installOpenApi(app);
    await app.register(cors, {
      origin:
        config.nodeEnv === 'development'
          ? [/^https?:\/\/localhost:\d+$/, /^https?:\/\/127\.0\.0\.1:\d+$/]
          : false,
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });
    app.get(
      '/health',
      { schema: { tags: ['Health'], summary: 'Dependency health' } },
      async (request, reply) => {
        const health = await execution.run(
          Availability.use((availability) =>
            availability.health(app.connectionsState.isShuttingDown)
          ),
          { signal: request.ingestorSignal }
        );
        if (health.status === 'healthy') return health;
        return sendProblem(reply, 503, 'service-unavailable', 'Service unavailable', {
          healthStatus: health.status,
          checks: health.checks,
          timestamp: health.timestamp,
          totalDurationMs: health.totalDurationMs,
        });
      }
    );
    app.get(
      '/ready',
      { schema: { tags: ['Health'], summary: 'Readiness' } },
      async (request, reply) => {
        const ready = await execution.run(
          Availability.use((availability) =>
            availability.ready(
              app.connectionsState.isShuttingDown,
              app.connectionsState.connectionsInitialized
            )
          ),
          { signal: request.ingestorSignal }
        );
        if (ready.ready) return ready;
        return sendProblem(reply, 503, 'service-unavailable', 'Service unavailable', { ...ready });
      }
    );
    await app.register(multipart, {
      limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
    });
    await app.register(async (uploads) => {
      if (config.nodeEnv !== 'test')
        await uploads.register(clerkPlugin, {
          secretKey: config.clerkSecretKey,
          publishableKey: config.clerkPublishableKey,
          hookName: 'onRequest',
        });
      uploads.post(
        '/upload',
        {
          schema: uploadSchema,
          onRequest: async (request, reply) => {
            const profileId =
              config.nodeEnv === 'test' ? testProfile(request) : getAuth(request).userId;
            if (!profileId)
              return reply
                .code(401)
                .type('application/problem+json')
                .send(problem(401, 'unauthorized', 'Unauthorized'));
            request.ingestorProfileId = profileId;
          },
        },
        async (request, reply) => {
          const principal = { profileId: request.ingestorProfileId ?? '' };
          const admitted = await execution.run(
            Admission.use((admission) => admission.admit(principal)),
            { signal: request.ingestorSignal }
          );
          if (admitted._tag === 'Unauthorized')
            return sendProblem(reply, 401, 'unauthorized', 'Unauthorized');
          if (admitted._tag === 'Limited') {
            reply
              .header('Retry-After', admitted.retryAfter)
              .header('X-RateLimit-Limit', config.rateLimitMax)
              .header('X-RateLimit-Remaining', 0)
              .header('X-RateLimit-Reset', admitted.reset);
            return sendProblem(reply, 429, 'rate-limit-exceeded', 'Rate Limit Exceeded', {
              retryAfter: admitted.retryAfter,
            });
          }
          const file = await readUpload(request);
          if (!file) return sendProblem(reply, 400, 'missing-file', 'Missing File');
          const { bytes } = file;
          const result = await execution.run(
            Ingestion.use((ingestion) =>
              observeUpload(
                ingestion.upload({
                  principal,
                  bytes,
                  filename: file.filename,
                  declaredMimeType: file.mimetype,
                }),
                bytes.length
              )
            ).pipe(Effect.catchTag('IngestionUnavailable', () => Effect.succeed(undefined))),
            { signal: request.ingestorSignal }
          );
          reply
            .header('X-RateLimit-Limit', config.rateLimitMax)
            .header('X-RateLimit-Remaining', admitted.remaining)
            .header('X-RateLimit-Reset', admitted.reset);
          if (result === undefined)
            return sendProblem(reply, 503, 'service-unavailable', 'Service unavailable');
          return sendUpload(reply, result);
        }
      );
    });
    return app;
  } catch (error) {
    await app.close().finally(() => runtime.dispose());
    throw error;
  }
}

async function readUpload(
  request: FastifyRequest
): Promise<{ bytes: Buffer; filename: string; mimetype: string } | undefined> {
  let file: { bytes: Buffer; filename: string; mimetype: string } | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file')
      file = { bytes: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
  }
  return file;
}
