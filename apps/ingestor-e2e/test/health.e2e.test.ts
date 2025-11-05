import { describe, test, expect } from 'vitest';
import { request } from 'undici';
import { baseUrl } from './setup.js';

describe('Health Endpoint E2E', () => {
  test('GET /health returns healthy status', async () => {
    // Act: Make HTTP request to Docker container
    const response = await request(`${baseUrl}/health`, {
      method: 'GET',
    });

    // Verify: HTTP response
    expect(response.statusCode).toBe(200);

    const body = await response.body.json();

    // Verify: Response structure
    expect(body).toMatchObject({
      status: 'healthy',
      checks: {
        database: true,
        minio: true,
        nats: true,
        otel: true,
      },
      timestamp: expect.any(String),
    });
  });

  test('GET /ready returns ready status', async () => {
    // Act: Make HTTP request to Docker container
    const response = await request(`${baseUrl}/ready`, {
      method: 'GET',
    });

    // Verify: HTTP response
    expect(response.statusCode).toBe(200);

    const body = await response.body.json();

    // Verify: Response structure
    expect(body).toMatchObject({
      ready: true,
      timestamp: expect.any(String),
    });
  });
});
