export { BaseConnection } from "./base/index.js";
export * from "./types.js";
export { createPool, checkPoolHealth, type PoolOptions } from "./database.js";
export { createS3Client, checkS3Health, type S3ClientOptions } from "./minio.js";
export { MinioConnection, type MinioConnectionOptions } from "./minio-connection.js";
export { createNatsConnection, checkNatsHealth } from "./nats.js";
export {
  createRedisClient,
  checkRedisHealth,
  closeRedisClient,
  type RedisClientOptions,
} from "./redis.js";
export { createOtelSdk, shutdownOtelSdk, type OtelOptions } from "./otel.js";
export { OtelConnection, type OtelConnectionOptions } from "./otel-connection.js";
