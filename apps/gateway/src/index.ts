import 'reflect-metadata';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';
import { createApp } from './app.js';

// Load configuration
const config = loadConfig();

// Initialize OpenTelemetry IMMEDIATELY (before importing/using app)
initializeOtel(config);

// Graceful shutdown handler
async function gracefulShutdown(signal: string, fastify: FastifyInstance) {
  fastify.log.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    await fastify.close();
    fastify.log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    fastify.log.error({ err: error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

// Start the server
async function start() {
  try {
    const fastify = await createApp(config);

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', fastify));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', fastify));

    // Start Fastify server
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    fastify.log.info(`Server is running on port ${config.port}`);
    fastify.log.info(`Health check available at http://localhost:${config.port}/health`);
    fastify.log.info(`Readiness check available at http://localhost:${config.port}/ready`);
    fastify.log.info(`GraphQL endpoint available at http://localhost:${config.port}/graphql`);
    if (config.nodeEnv === 'development') {
      fastify.log.info(`GraphiQL IDE available at http://localhost:${config.port}/graphiql`);
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the application
start();
