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
  readonly port: number;
  readonly rateLimitMax: number;
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
    ingestorProfileId?: string;
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
  const app = Fastify({ logger: options.logger ?? false, forceCloseConnections: 'idle' });
  app.decorate('connectionsState', { isShuttingDown: false, connectionsInitialized: false });
  app.addHook('onClose', () => runtime.dispose());
  try {
    const execution = await runtime.runPromise(HttpExecution, { signal: options.signal });
    await app.register(multipart, {
      limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
    });
    if (config.nodeEnv !== 'test')
      await app.register(clerkPlugin, { secretKey: config.clerkSecretKey });
    app.post(
      '/upload',
      {
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
          Admission.use((admission) => admission.admit(principal))
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
        const file = await request.file();
        if (!file)
          return reply
            .code(400)
            .type('application/problem+json')
            .send(problem(400, 'missing-file', 'Missing File'));
        const bytes = await file.toBuffer();
        const result = await execution.run(
          Ingestion.use((ingestion) =>
            ingestion.upload({
              principal,
              bytes,
              filename: file.filename,
              declaredMimeType: file.mimetype,
            })
          ).pipe(Effect.catchTag('IngestionUnavailable', () => Effect.succeed(undefined)))
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
    return app;
  } catch (error) {
    await app.close().finally(() => runtime.dispose());
    throw error;
  }
}
