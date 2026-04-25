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
  entryPoints: ['src/index.ts'],
  platform: 'node',
  target: ['node22'],
  bundle: true,
  outfile: 'dist/index.mjs',
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
