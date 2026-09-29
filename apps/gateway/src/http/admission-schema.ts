import type { FastifyInstance } from 'fastify';

const limitHeader = {
  description: 'Capacity of the current shared or local bucket in cost points.',
  type: 'integer',
};
const retryHeader = {
  description: 'Minimum wait in seconds before retrying. Overload requires a manual retry.',
  type: 'integer',
};

function rejection(code: string, description: string, quota: boolean) {
  return {
    description,
    type: 'object',
    additionalProperties: true,
    headers: {
      'Retry-After': retryHeader,
      ...(quota ? { 'X-RateLimit-Cost-Limit': limitHeader } : {}),
    },
    required: ['errors'],
    properties: {
      data: { type: 'object', nullable: true, additionalProperties: true },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['message', 'extensions'],
          properties: {
            message: { type: 'string' },
            extensions: {
              type: 'object',
              additionalProperties: true,
              required: quota ? ['code', 'retryAfter'] : ['code'],
              properties: {
                code: { type: 'string', enum: [code] },
                retryAfter: {
                  type: 'number',
                  description: 'Suggested retry delay in milliseconds.',
                },
              },
            },
          },
        },
      },
    },
  };
}

/** Extend Mercurius route contracts without changing its successful response shape. */
export function installAdmissionSchema(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    if (route.url !== '/graphql' || !route.schema) return;
    const responses = route.schema.response;
    if (typeof responses !== 'object' || responses === null) return;
    const success = '2xx' in responses ? responses['2xx'] : undefined;
    route.schema = {
      ...route.schema,
      response: {
        ...responses,
        ...(typeof success === 'object' && success !== null
          ? {
              '2xx': {
                ...success,
                headers: {
                  'X-RateLimit-Cost-Limit': limitHeader,
                  'X-RateLimit-Cost-Remaining': {
                    type: 'integer',
                    description: 'Remaining cost points after admission.',
                  },
                  'X-RateLimit-Cost-Reset': {
                    type: 'integer',
                    description:
                      'Unix timestamp in milliseconds when this bucket will be full without further charges.',
                  },
                },
              },
            }
          : {}),
        429: rejection(
          'RATE_LIMIT_EXCEEDED',
          'The shared or local cost-point budget is exhausted.',
          true
        ),
        503: rejection(
          'GATEWAY_OVERLOADED',
          'Admission capacity, active work, or the request deadline prevents completion.',
          false
        ),
      },
    };
  });
}
