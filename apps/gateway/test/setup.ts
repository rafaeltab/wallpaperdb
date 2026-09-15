import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { createSearchFixture } from './search-fixture.js';

/** Private broker, application and indices; only the physical search server is shared. */
export function createGatewayTester(
  options: { app?: boolean; configOverrides?: Partial<Config> } = {}
) {
  const Tester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(NatsTesterBuilder)
    .build();
  const broker = new Tester()
    .withNats((nats) => nats.withJetstream())
    .withStream('WALLPAPER')
    .withStream('PROFILE');
  const search = createSearchFixture();
  let app: FastifyInstance | undefined;
  let config: Config | undefined;
  return {
    search,
    nats: broker.nats,
    async setup() {
      await broker.setup();
      config = {
        ...loadConfig({
          NODE_ENV: 'test',
          OPENSEARCH_URL: search.options.url,
          OPENSEARCH_USERNAME: search.options.username,
          OPENSEARCH_PASSWORD: search.options.password,
          OPENSEARCH_INDEX: search.options.wallpaperIndex,
          OPENSEARCH_PROFILE_INDEX: search.options.profileIndex,
          NATS_URL: broker.nats.config.endpoints.fromHost,
          REDIS_ENABLED: 'false',
          MEDIA_SERVICE_URL: 'http://media.example.test',
          CURSOR_SECRET: 'gateway-test-secret-at-least-thirty-two-characters',
        }),
        ...options.configOverrides,
      };
      if (options.app !== false) {
        app = await createApp(config, { logger: false, enableOtel: false });
      }
    },
    getApp() {
      if (!app) throw new Error('Call setup() with the application enabled before getApp().');
      return app;
    },
    getGatewayConfig() {
      if (!config) throw new Error('Call setup() before getGatewayConfig().');
      return config;
    },
    async destroy() {
      try {
        await app?.close();
      } finally {
        try {
          await broker.destroy();
        } finally {
          await search.destroy();
        }
      }
    },
  };
}
