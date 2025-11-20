import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "url-ipv4-resolver",
        globals: true,
        environment: "node",
        include: ["test/**/*.test.ts"],
        testTimeout: 60000, // 60 seconds for testcontainers
        hookTimeout: 60000,
        maxConcurrency: 30,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html", "lcov", "json-summary"],
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "test/**/*.ts"],
            reportsDirectory: "../../coverage",
        },
    },
});
