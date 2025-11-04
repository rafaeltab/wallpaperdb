import esbuild from 'esbuild';
import { builtinModules } from 'module';

await esbuild.build({
  entryPoints: ['src/index.ts'], // your Fastify entry
  platform: 'node',
  target: ['node22'], // set to your deployment runtime (node18/node20)
  bundle: true,
  outfile: 'dist/index.mjs',
  format: 'esm', // use "cjs" if your code uses require()
  sourcemap: true, // set true if you want prod source maps
  minify: false,
  logLevel: 'info',

  // Keep all npm packages external, only bundle our own code
  packages: 'external',

  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },

  loader: {
    '.json': 'json',
  },
});
