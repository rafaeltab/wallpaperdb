import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "test-utils",
        globals: true,
        environment: "node",
        include: ['tests/**/*.test.ts'],
        testTimeout: 30000, // 60 seconds for testcontainers
        hookTimeout: 30000,
        maxConcurrency: 3,
        fileParallelism: true, // Disabled - with 80GB Docker memory, parallel execution should work
        retry: 3,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'tests/**/*.ts'],
            reportsDirectory: '../../coverage',
        },
    },
});
