import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

const LOCAL_ORIGINS = [/localhost:\d+/, /127\.0\.0\.1:\d+/];

export async function registerUserCors(
  fastify: FastifyInstance,
  nodeEnv: Config['nodeEnv']
): Promise<void> {
  await fastify.register(cors, {
    origin: nodeEnv === 'development' ? LOCAL_ORIGINS : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}
