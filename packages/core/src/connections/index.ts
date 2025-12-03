export { BaseConnection } from "./base/index.js";
export * from "./types.js";
export { createPool, checkPoolHealth, type PoolOptions } from "./database.js";
export {
  DatabaseConnection,
  type DatabaseConnectionOptions,
  type DatabaseClient,
} from "./database-connection.js";
export { createS3Client, checkS3Health, type S3ClientOptions } from "./minio.js";
export { MinioConnection, type MinioConnectionOptions } from "./minio-connection.js";
export { createNatsConnection, checkNatsHealth } from "./nats.js";
export {
  NatsConnectionManager,
  type NatsConnectionOptions,
} from "./nats-connection.js";
export {
  createRedisClient,
  checkRedisHealth,
  closeRedisClient,
  type RedisClientOptions,
} from "./redis.js";
export {
  RedisConnection,
  type RedisConnectionOptions,
} from "./redis-connection.js";
export { createOtelSdk, shutdownOtelSdk, type OtelOptions } from "./otel.js";
export { OtelConnection, type OtelConnectionOptions } from "./otel-connection.js";
export {
  createOpenSearchClient,
  checkOpenSearchHealth,
  type OpenSearchClientOptions,
} from "./opensearch.js";
export {
  OpenSearchConnection,
  type OpenSearchConnectionOptions,
} from "./opensearch-connection.js";
