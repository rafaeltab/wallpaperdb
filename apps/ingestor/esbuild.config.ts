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
  entryPoints: ['src/index.ts'], // your Fastify entry
  platform: 'node',
  target: ['node22'], // set to your deployment runtime (node18/node20)
  bundle: true,
  outdir: 'dist',
  splitting: true,
  outExtension: { '.js': '.mjs' },
  format: 'esm', // use "cjs" if your code uses require()
  sourcemap: true, // set true if you want prod source maps
  minify: false,
  logLevel: 'info',

  loader: {
    '.json': 'json',
  },
  plugins: [externalizeExceptWorkspaces()],
});
