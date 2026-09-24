import { build, type Plugin } from 'esbuild';

function externalizeExceptWorkspaces() {
  return {
    name: 'externalize-except-workspaces',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('.')) {
          return;
        }

        const isWallpaperDbPackage = args.path.startsWith('@wallpaperdb');
        if (isWallpaperDbPackage) {
          return;
        }

        return { path: args.path, external: true };
      });
    },
  } satisfies Plugin;
}

await build({
  entryPoints: { index: 'src/index.ts', encoder: 'src/adapters/image/encoder.ts' },
  platform: 'node',
  target: ['node22'],
  bundle: true,
  splitting: true,
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  format: 'esm',
  sourcemap: true,
  minify: false,
  logLevel: 'info',

  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },

  loader: {
    '.json': 'json',
  },
  plugins: [externalizeExceptWorkspaces()],
});
