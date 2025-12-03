/**
 * Configuration interfaces for connection managers.
 * Services should pick the config properties they need.
 */

export interface DatabaseConfig {
  databaseUrl: string;
}

export interface MinioConfig {
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
}

export interface NatsConfig {
  natsUrl: string;
  serviceName: string;
}

export interface RedisConfig {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisEnabled: boolean;
}

export interface OtelConfig {
  otelEndpoint?: string;
  otelServiceName: string;
}
