import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "ingestor-e2e",
        testTimeout: 60000,
        hookTimeout: 60000,
        fileParallelism: true,
        maxConcurrency: 5,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
            include: ['test/**/*.ts'],
            exclude: ['test/**/*.d.ts'],
            reportsDirectory: './coverage',
        },
    },
});
