import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        testTimeout: 30000, // 60 seconds for testcontainers
        hookTimeout: 30000,
        maxConcurrency: 3,
        fileParallelism: true, // Disabled - with 80GB Docker memory, parallel execution should work
        retry: 3,
    },
});
