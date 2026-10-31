import { build, type Plugin } from 'esbuild';
const externalPackages: Plugin = {
  name: 'external-packages',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      if (
        args.kind === 'entry-point' ||
        args.path.startsWith('.') ||
        args.path.startsWith('/') ||
        args.path.startsWith('@wallpaperdb/')
      )
        return undefined;
      return { path: args.path, external: true };
    });
  },
};
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/main.js',
  sourcemap: true,
  plugins: [externalPackages],
});
