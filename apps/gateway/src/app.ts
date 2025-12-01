import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import mercurius from 'mercurius';
import { container } from 'tsyringe';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import type { Config } from './config.js';
import { OpenSearchConnection } from './connections/opensearch.js';
import { registerRoutes } from './routes/index.js';
import { getOtelSdk } from './otel-init.js';

// GraphQL schema (placeholder for now)
const schema = `
  type Query {
    hello: String
  }
`;

// GraphQL resolvers (placeholder for now)
const resolvers = {
  Query: {
    hello: () => 'Hello from WallpaperDB Gateway!',
  },
};

// Connection state interface
export interface ConnectionsState {
  isShuttingDown: boolean;
  connectionsInitialized: boolean;
}

// Extend Fastify instance with our custom state
declare module 'fastify' {
  interface FastifyInstance {
    connectionsState: ConnectionsState;
    container: typeof container;
  }
}

export async function createApp(
  config: Config,
  options?: { logger?: boolean; enableOtel?: boolean }
): Promise<FastifyInstance> {
  // Register config in DI container
  container.register('config', { useValue: config });

  // Register pre-initialized OTEL SDK
  const otelSdk = getOtelSdk();
  if (otelSdk) {
    container.register('otelSdk', { useValue: otelSdk });
  }

  // Create Fastify server
  const fastify = Fastify({
    logger:
      options?.logger !== false
        ? {
            level: config.nodeEnv === 'development' ? 'debug' : 'info',
            transport:
              config.nodeEnv === 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                      translateTime: 'HH:MM:ss Z',
                      ignore: 'pid,hostname',
                    },
                  }
                : undefined,
          }
        : false,
  });

  // Attach container to Fastify instance
  fastify.decorate('container', container);

  // Initialize connection state
  fastify.decorate('connectionsState', {
    isShuttingDown: false,
    connectionsInitialized: false,
  });

  // Register CORS for development
  await fastify.register(cors, {
    origin: config.nodeEnv === 'development' ? [/localhost:\d+/, /127\.0\.0\.1:\d+/] : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Register OpenAPI documentation
  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Gateway API',
    version: '1.0.0',
    description:
      'GraphQL gateway for querying wallpapers. Provides read-optimized access with flexible filtering capabilities.',
    servers:
      config.nodeEnv === 'production'
        ? undefined
        : [{ url: `http://localhost:${config.port}`, description: 'Local development server' }],
  });

  // Register GraphQL with Mercurius
  await fastify.register(mercurius, {
    schema,
    resolvers,
    graphiql: config.nodeEnv === 'development', // Enable GraphiQL in development
    path: '/graphql',
  });

  // Initialize connections
  fastify.log.info('Initializing connections...');

  try {
    const opensearch = container.resolve(OpenSearchConnection);
    await opensearch.connect();
    fastify.log.info('OpenSearch connection established');

    // Mark connections as initialized
    fastify.connectionsState.connectionsInitialized = true;
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize connections');
    throw error;
  }

  // Register HTTP routes (health checks, etc.)
  await registerRoutes(fastify);

  // Graceful shutdown handler
  fastify.addHook('onClose', async () => {
    fastify.connectionsState.isShuttingDown = true;
    fastify.log.info('Closing OpenSearch connection...');
    const opensearch = container.resolve(OpenSearchConnection);
    await opensearch.disconnect();
  });

  return fastify;
}
