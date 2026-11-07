import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { checkServiceWiring } from "./check-service-wiring.ts";
test("service audit requires deployment, environment, health, ingress and Bruno wiring", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "service-wiring-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	};
	write("apps/example/Dockerfile", "FROM scratch");
	write("apps/example/Dockerfile.dev", "FROM scratch");
	write("apps/example/.env.example", "PORT=3000");
	write("infra/caddy/Caddyfile", "reverse_proxy example:3000");
	write(
		"api/environments/local.bru.example",
		"vars {\n baseUrl: http://localhost/example\n}",
	);
	write("api/example/health.bru", "get {\n url: {{baseUrl}}/health\n}");
	const service = {
		build: { dockerfile: "apps/example/Dockerfile.dev" },
		env_file: [{ path: path.join(root, "apps/example/.env") }],
		healthcheck: { test: ["CMD", "true"] },
	};
	expect(
		checkServiceWiring(root, { services: { example: service } }),
	).toStrictEqual([]);
	expect(checkServiceWiring(root, { services: {} }).length).toBeTruthy();
	expect(
		checkServiceWiring(root, {
			services: { example: { ...service, healthcheck: {} } },
		}).length,
	).toBeTruthy();
});
