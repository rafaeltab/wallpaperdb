import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { build } from 'esbuild';
import { configuration } from './vitest.config.ts';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
await mkdir(join(root, 'coverage'), { recursive: true });
const directory = await mkdtemp(join(root, 'coverage/inspector-build-'));

// Vitest remaps native TS as stripped source, which does not match tsx's offsets.
// Exercise the same adapter/worker with production-style bundles and their source maps.
try {
  await build({
    entryPoints: {
      storage: join(root, 'src/adapters/sources/index.ts'),
      'inspect-worker': join(root, 'src/adapters/sources/inspect-worker.ts'),
    },
    bundle: true,
    splitting: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outdir: directory,
    outExtension: { '.js': '.mjs' },
    sourcemap: 'inline',
    plugins: [
      {
        name: 'external-dependencies',
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
            if (path.startsWith('@wallpaperdb/')) return;
            return {
              path: path.startsWith('node:') ? path : require.resolve(path),
              external: true,
            };
          });
        },
      },
    ],
  });
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}

export default defineBaseConfig({
  ...configuration,
  plugins: [
    {
      name: 'compiled-inspector-coverage',
      enforce: 'pre',
      configureVitest({ vitest }) {
        vitest.onClose(() => rm(directory, { recursive: true, force: true }));
      },
      resolveId(source, importer) {
        if (
          importer?.includes('/source-storage.integration.test.ts') &&
          source.endsWith('/src/adapters/sources/index.js')
        ) {
          return join(directory, 'storage.mjs');
        }
      },
    },
  ],
  test: {
    ...configuration.test,
    name: 'asset-integration',
    setupFiles: ['./test/inspector-coverage.setup.ts'],
    coverage: {
      ...configuration.test.coverage,
      autoAttachSubprocess: true,
      excludeAfterRemap: true,
      include: [...configuration.test.coverage.include, `coverage/${basename(directory)}/**/*.mjs`],
    },
    include: ['test/**/*.integration.test.ts'],
  },
});
