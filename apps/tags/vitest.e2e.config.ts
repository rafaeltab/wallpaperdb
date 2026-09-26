import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'tags-image',
    environment: 'node',
    include: ['test/**/*.e2e.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
    maxConcurrency: 1,
  },
});
