import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import Fastify from 'fastify';
import { container } from 'tsyringe';
import { registerRoutes } from './routes/index.js';

async function generateSwagger(): Promise<string> {
  container.register('config', {
    useValue: {},
  });

  const fastify = Fastify({
    logger: false,
  });

  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Tags API',
    version: '1.0.0',
    description:
      'Tags service shell. Only operational endpoints are exposed today while PostgreSQL and NATS integrations are wired for future work.',
    servers: [{ url: 'http://localhost:3008', description: 'Local development server' }],
  });

  await registerRoutes(fastify);
  await fastify.ready();

  const swagger = fastify.swagger();

  try {
    await fastify.close();
  } catch {}

  return JSON.stringify(swagger, null, 2);
}

const swagger = await generateSwagger();

writeFile('swagger.json', swagger);
