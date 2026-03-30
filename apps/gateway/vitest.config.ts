import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
// Force all imports of 'graphql' — whether ESM (index.mjs) or CJS (index.js) —
// to resolve to the same CJS file. This prevents the "from another module or
// realm" error that occurs when Vitest's ESM transform picks index.mjs while
// CJS packages (mercurius) load index.js, producing two distinct class identities.
const graphqlPath = require.resolve('graphql');

export default defineConfig({
    resolve: {
        alias: {
            graphql: graphqlPath,
        },
    },
    test: {
        setupFiles: ["test/setup.ts"],
        name: 'gateway',
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 60000, // 60 seconds for testcontainers
        hookTimeout: 120000,
        fileParallelism: false,
        maxConcurrency: 1,
        isolate: false,
        pool: "threads",
        poolOptions: {
            threads: {
                minThreads: 1,
                isolate: false,
                maxThreads: 1,
                singleThread: true,
            }
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
            reportsDirectory: './coverage',
        },
        deps: {
            optimizer: {
                ssr: {
                    enabled: false,
                    exclude: ['graphql', 'mercurius']
                },
                web: {
                    enabled: false,
                    exclude: ['graphql', 'mercurius']
                },
            }
        }
    },

    optimizeDeps: {
        exclude: ['graphql', 'mercurius'],
    },
    ssr: {
        noExternal: ['mercurius'], // if needed to avoid double-bundling behavior
    },
});

