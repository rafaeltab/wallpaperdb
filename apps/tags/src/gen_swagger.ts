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
      'Tags service scaffold. Defines the HTTP surface and database model for tag management, wallpaper tag assignments, and tag suggestions.',
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
