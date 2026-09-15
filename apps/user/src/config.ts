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
    profileBiographyMaxLength: z.number().int().positive(),
    profileRetainedAliasLimit: z.number().int().nonnegative(),
    s3Endpoint: z.string().url().optional(),
    s3AccessKeyId: z.string().min(1).optional(),
    s3SecretAccessKey: z.string().min(1).optional(),
    s3Region: z.string().default('us-east-1'),
    profilePictureBucket: z.string().min(1),
    profilePictureMaxBytes: z.number().int().positive(),
    profilePictureMaxPixels: z.number().int().positive(),
    profilePictureMaxDecodedBytes: z.number().int().positive(),
    profilePictureImportTimeoutMs: z.number().int().positive(),
    profilePictureImportHosts: z.array(z.string().min(1)).min(1),
    userMediaServiceToken: z.string().min(1).optional(),
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
    profileBiographyMaxLength: parseIntEnv(process.env.PROFILE_BIOGRAPHY_MAX_LENGTH, 5000),
    profileRetainedAliasLimit: parseIntEnv(process.env.PROFILE_RETAINED_ALIAS_LIMIT, 3),
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Region: getEnv('S3_REGION', 'us-east-1'),
    profilePictureBucket: getEnv('PROFILE_PICTURE_BUCKET', 'profile-pictures'),
    profilePictureMaxBytes: parseIntEnv(process.env.PROFILE_PICTURE_MAX_BYTES, 5 * 1024 * 1024),
    profilePictureMaxPixels: parseIntEnv(process.env.PROFILE_PICTURE_MAX_PIXELS, 16_000_000),
    profilePictureMaxDecodedBytes: parseIntEnv(
      process.env.PROFILE_PICTURE_MAX_DECODED_BYTES,
      64 * 1024 * 1024
    ),
    profilePictureImportTimeoutMs: parseIntEnv(
      process.env.PROFILE_PICTURE_IMPORT_TIMEOUT_MS,
      10_000
    ),
    profilePictureImportHosts: (
      getEnv('PROFILE_PICTURE_IMPORT_HOSTS', 'img.clerk.com,images.clerk.dev') ?? ''
    )
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    userMediaServiceToken: process.env.USER_MEDIA_SERVICE_TOKEN,
  };

  return configSchema.parse(raw);
}
