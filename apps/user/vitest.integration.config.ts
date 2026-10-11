import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { configuration } from './vitest.config.ts';

export default defineBaseConfig({
  ...configuration,
  test: {
    ...configuration.test,
    name: 'user-integration',
    include: ['test/**/*.integration.test.ts'],
  },
});
