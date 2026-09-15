import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
  OpenSearchTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { Config } from '../src/config.js';
import { InProcessGatewayTesterBuilder } from './builders/index.js';

/** A fresh, independently owned infrastructure fixture for each integration suite. */
export function createGatewayTester(
  options: { app?: boolean; configOverrides?: Partial<Config> } = {}
) {
  const Tester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(OpenSearchTesterBuilder)
    .with(NatsTesterBuilder)
    .with(InProcessGatewayTesterBuilder)
    .build();
  const tester = new Tester()
    .withNats((nats) => nats.withJetstream())
    .withStream('WALLPAPER')
    .withStream('PROFILE')
    .withOpenSearch();
  if (options.app !== false) tester.withInProcessApp(options.configOverrides);
  return tester;
}
