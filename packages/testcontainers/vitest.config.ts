import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
    test: {
        name: "testcontainers",
        globals: true,
        environment: "node",
        include: ['test/**/*.test.ts'],
        testTimeout: 60000, // 60 seconds for testcontainers
        hookTimeout: 60000,
        maxConcurrency: 30,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'test/**/*.ts'],
            reportsDirectory: './coverage',
        },
    },
});
