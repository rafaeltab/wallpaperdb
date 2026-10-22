import { defineConfig, mergeConfig } from 'vitest/config';
import unit from './vitest.unit.config.ts';

export default defineConfig(async (environment) => {
  const base = typeof unit === 'function' ? await unit(environment) : await unit;
  return mergeConfig(base, {
    test: {
      env: {
        // Every input consumed by loadConfig is present before dotenv runs.
        // Ambient values and the ignored .env file cannot override these values.
        DOTENV_KEY: '',
        NODE_ENV: 'test',
        PORT: '3009',
        DATABASE_URL: 'postgresql://mutation:mutation@127.0.0.1:5432/mutation',
        NATS_URL: 'nats://127.0.0.1:4222',
        NATS_STREAM: 'WALLPAPER',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        OTEL_SERVICE_NAME: 'user-mutation',
        CLERK_SECRET_KEY: 'mutation',
        CLERK_PUBLISHABLE_KEY: 'mutation',
        PROFILE_HANDLE_MIN_LENGTH: '1',
        PROFILE_HANDLE_MAX_LENGTH: '30',
        PROFILE_DISPLAY_NAME_MAX_LENGTH: '80',
        PROFILE_BIOGRAPHY_MAX_LENGTH: '5000',
        PROFILE_RETAINED_ALIAS_LIMIT: '3',
        PROFILE_EVIDENCE_RETENTION_DAYS: '30',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_ACCESS_KEY_ID: 'mutation',
        S3_SECRET_ACCESS_KEY: 'mutation',
        S3_REGION: 'us-east-1',
        PROFILE_PICTURE_BUCKET: 'profile-pictures',
        PROFILE_PICTURE_MAX_BYTES: '5242880',
        PROFILE_PICTURE_MAX_PIXELS: '16000000',
        PROFILE_PICTURE_MAX_DECODED_BYTES: '536870912',
        PROFILE_PICTURE_IMPORT_TIMEOUT_MS: '10000',
        PROFILE_PICTURE_IMPORT_HOSTS: 'img.clerk.com,images.clerk.dev',
        USER_MEDIA_SERVICE_TOKEN: 'mutation',
      },
    },
  });
});
