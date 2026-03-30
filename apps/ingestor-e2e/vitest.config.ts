import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
    test: {
        name: "ingestor-e2e",
        testTimeout: 60000,
        hookTimeout: 60000,
        fileParallelism: true,
        maxConcurrency: 5,
        coverage: {
            provider: 'v8',
            include: ['test/**/*.ts'],
            exclude: ['test/**/*.d.ts'],
            reportsDirectory: './coverage',
        },
    },
});
