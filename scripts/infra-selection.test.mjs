import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function services(...profiles) {
	const result = spawnSync(
		"docker",
		[
			"compose",
			"-f",
			"infra/docker-compose.yml",
			...profiles.flatMap((profile) => ["--profile", profile]),
			"config",
			"--services",
		],
		{ encoding: "utf8", env: { ...process.env, COMPOSE_PROFILES: "" } },
	);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim().split("\n").sort();
}

const required = [
	"lgtm",
	"nats",
	"nats-setup",
	"opensearch",
	"postgres",
	"redis",
	"seaweedfs",
];

test("headless Compose selection retains dependencies and the telemetry collector without admin services", () => {
	assert.deepEqual(services(), required);
});

test("developers can enable both admin services alongside their dependencies", () => {
	assert.deepEqual(
		services("admin"),
		[...required, "opensearch-dashboards", "pgadmin"].sort(),
	);
});
