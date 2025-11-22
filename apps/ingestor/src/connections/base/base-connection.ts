// Re-export BaseConnection from the shared core package
// All connections should use: extends BaseConnection<ClientType, Config>
export { BaseConnection } from "@wallpaperdb/core/connections/base";
