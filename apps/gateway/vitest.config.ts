import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    },
});

