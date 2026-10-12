import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { configuration } from './vitest.config.ts';

export default defineBaseConfig({
  ...configuration,
  test: {
    ...configuration.test,
    name: 'user-unit',
    include: ['test/**/*.unit.test.ts'],
    coverage: {
      ...configuration.test.coverage,
      reportsDirectory: './coverage/unit',
    },
  },
});
