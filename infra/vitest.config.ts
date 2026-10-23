import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: { name: "infra-unit", include: ["nats/init/**/*.test.ts"] },
});
