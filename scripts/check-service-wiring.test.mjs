import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkServiceWiring } from "./check-service-wiring.mjs";
test("service audit requires deployment, environment, health, ingress and Bruno wiring", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "service-wiring-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const write = (file, text) => {
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
	assert.deepEqual(
		checkServiceWiring(root, { services: { example: service } }),
		[],
	);
	assert.ok(checkServiceWiring(root, { services: {} }).length);
	assert.ok(
		checkServiceWiring(root, {
			services: { example: { ...service, healthcheck: {} } },
		}).length,
	);
});
