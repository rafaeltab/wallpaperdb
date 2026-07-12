import {
  DatabaseConfigSchema,
  getEnv,
  NatsConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  ServerConfigSchema,
} from '@wallpaperdb/core/config';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

export const configSchema = z
  .object({
    ...ServerConfigSchema.shape,
    ...DatabaseConfigSchema.shape,
    ...NatsConfigSchema.shape,
    ...OtelConfigSchema.shape,
    clerkDomain: z.string().min(1).optional(),
    clerkSecretKey: z.string().min(1).optional(),
    profileHandleMinLength: z.number().int().positive().default(1),
    profileHandleMaxLength: z.number().int().positive().default(30),
    profileHandleAllocationAttempts: z.number().int().positive().default(10),
    profileReservedHandles: z.array(z.string()).default([]),
  })
  .superRefine((config, context) => {
    if (config.profileHandleMinLength > config.profileHandleMaxLength) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profileHandleMinLength'],
        message: 'Profile Handle minimum length cannot exceed maximum length',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    port: parseIntEnv(process.env.PORT, 3009),
    nodeEnv,
    databaseUrl: process.env.DATABASE_URL,
    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'user'),
    clerkDomain: process.env.CLERK_DOMAIN,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    profileHandleMinLength: parseIntEnv(process.env.PROFILE_HANDLE_MIN_LENGTH, 1),
    profileHandleMaxLength: parseIntEnv(process.env.PROFILE_HANDLE_MAX_LENGTH, 30),
    profileHandleAllocationAttempts: parseIntEnv(
      process.env.PROFILE_HANDLE_ALLOCATION_ATTEMPTS,
      10
    ),
    profileReservedHandles: (
      getEnv(
        'PROFILE_RESERVED_HANDLES',
        'admin,api,health,profile,profiles,ready,security,support'
      ) ?? ''
    )
      .split(',')
      .map((handle) => handle.trim().toLowerCase())
      .filter(Boolean),
  };

  return configSchema.parse(raw);
}
