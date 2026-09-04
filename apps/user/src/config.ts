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

const configSchema = z
  .object({
    ...ServerConfigSchema.shape,
    ...DatabaseConfigSchema.shape,
    ...NatsConfigSchema.shape,
    ...OtelConfigSchema.shape,
    clerkSecretKey: z.string().min(1).optional(),
    clerkPublishableKey: z.string().min(1).optional(),
    profileHandleMinLength: z.number().int().min(1).max(63),
    profileHandleMaxLength: z.number().int().min(1).max(64),
    profileDisplayNameMaxLength: z.number().int().positive(),
  })
  .superRefine((config, context) => {
    if (config.profileHandleMinLength > config.profileHandleMaxLength) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Profile Handle minimum length must not exceed its maximum length',
      });
    }
    if (config.nodeEnv !== 'test' && !config.clerkSecretKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clerkSecretKey'],
        message: 'CLERK_SECRET_KEY is required outside tests',
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
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    profileHandleMinLength: parseIntEnv(process.env.PROFILE_HANDLE_MIN_LENGTH, 1),
    profileHandleMaxLength: parseIntEnv(process.env.PROFILE_HANDLE_MAX_LENGTH, 30),
    profileDisplayNameMaxLength: parseIntEnv(process.env.PROFILE_DISPLAY_NAME_MAX_LENGTH, 80),
  };

  return configSchema.parse(raw);
}
