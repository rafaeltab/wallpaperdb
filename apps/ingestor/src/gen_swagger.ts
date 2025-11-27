import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import Fastify from 'fastify';
import { registerRoutes } from './routes/index.js';
import {
  UploadSuccessResponseJsonSchema,
  uploadBodySchemaForDocs,
} from './routes/schemas/upload.schema.js';
import { container } from 'tsyringe';

async function generateSwagger(): Promise<string> {
  container.register('config', {
    useValue: {},
  });
  // Create Fastify server
  const fastify = Fastify({
    logger: false,
  });

  // Register OpenAPI documentation
  await registerOpenAPI(fastify, {
    title: 'WallpaperDB Ingestor API',
    version: '1.0.0',
    description:
      'Wallpaper upload and ingestion service. Accepts wallpaper uploads, validates files, stores them in object storage, and publishes events for downstream processing.',
    servers: [{ url: `http://localhost:3001`, description: 'Local development server' }],
    additionalSchemas: {
      UploadSuccessResponse: UploadSuccessResponseJsonSchema,
    },
    multipartBodies: [
      {
        url: '/upload',
        schema: uploadBodySchemaForDocs,
        errorResponses: [
          {
            statusCode: 400,
            description: 'Validation error. The file format, size, or dimensions are invalid.',
          },
          {
            statusCode: 409,
            description:
              'Duplicate file. A file with the same content hash already exists for this user.',
          },
          {
            statusCode: 413,
            description: 'File too large. The file exceeds the maximum allowed size.',
          },
          {
            statusCode: 429,
            description: 'Rate limit exceeded. Too many upload requests in a short period.',
          },
          {
            statusCode: 500,
            description: 'Internal server error. An unexpected error occurred during processing.',
          },
        ],
      },
    ],
  });

  // Register all routes
  await registerRoutes(fastify);

  await fastify.ready();

  const swagger = fastify.swagger();

  try {
    await fastify.close();
  } catch (_) {}

  return JSON.stringify(swagger, null, 2);
}

const swagger = await generateSwagger();

writeFile('swagger.json', swagger);
