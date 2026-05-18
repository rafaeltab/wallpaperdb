import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import { registerRoutes } from '../src/routes/index.js';
import { HealthService } from '../src/services/health.service.js';

describe('tags shell routes', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    container.clearInstances();
  });

  it('exposes health endpoints', async () => {
    container.registerInstance(HealthService, {
      checkHealth: async () => ({
        status: 'healthy',
        checks: {},
        timestamp: new Date().toISOString(),
        totalDurationMs: 1,
      }),
      checkReady: () => ({
        ready: true,
        timestamp: new Date().toISOString(),
      }),
    } as HealthService);

    const app = Fastify();
    apps.push(app);
    app.decorate('connectionsState', {
      isShuttingDown: false,
      connectionsInitialized: true,
    });

    await registerOpenAPI(app, {
      title: 'Test Tags API',
      version: '1.0.0',
      description: 'Test shell',
    });
    await registerRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });

  it('does not publish domain routes yet', async () => {
    container.registerInstance(HealthService, {
      checkHealth: async () => ({
        status: 'healthy',
        checks: {},
        timestamp: new Date().toISOString(),
        totalDurationMs: 1,
      }),
      checkReady: () => ({
        ready: true,
        timestamp: new Date().toISOString(),
      }),
    } as HealthService);

    const app = Fastify();
    apps.push(app);
    app.decorate('connectionsState', {
      isShuttingDown: false,
      connectionsInitialized: true,
    });

    await registerOpenAPI(app, {
      title: 'Test Tags API',
      version: '1.0.0',
      description: 'Test shell',
    });
    await registerRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/tags' });

    expect(response.statusCode).toBe(404);
  });
});
