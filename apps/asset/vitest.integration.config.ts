import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { configuration } from './vitest.config.ts';

export default defineBaseConfig({
  ...configuration,
  test: {
    ...configuration.test,
    name: 'asset-integration',
    coverage: {
      ...configuration.test.coverage,
      autoAttachSubprocess: true,
    },
    include: ['test/**/*.integration.test.ts'],
  },
});
