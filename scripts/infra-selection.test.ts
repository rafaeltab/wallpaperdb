import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, test, type TestContext } from "vitest";

function services(
	t: TestContext & object,
	target: string,
	ambientProfiles: string,
) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-infra-selection-"));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	const selected = join(root, "services");
	// Run the real Make recipe, replacing only container startup with Compose's
	// daemon-free service selection. Preserve the recipe's environment and flags.
	writeFileSync(
		join(root, "docker"),
		`#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
assert.equal(args[0], 'compose');
assert.deepEqual(args.slice(-2), ['up', '-d']);
const result = spawnSync('docker', [...args.slice(0, -2), 'config', '--services'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: process.env.INFRA_TEST_PATH },
});
writeFileSync(process.env.INFRA_TEST_SERVICES, result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`,
		{ mode: 0o755 },
	);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${root}${delimiter}${process.env.PATH}`,
		INFRA_TEST_PATH: process.env.PATH,
		INFRA_TEST_SERVICES: selected,
		COMPOSE_PROFILES: ambientProfiles,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
	};
	delete env.INFRA_PROFILES;
	const result = spawnSync(
		"make",
		["--no-print-directory", target, "SHELL=/bin/sh"],
		{
			encoding: "utf8",
			env,
			timeout: 15_000,
		},
	);
	expect(result.status, result.stdout + result.stderr).toBe(0);
	return readFileSync(selected, "utf8").trim().split("\n").sort();
}

const required = [
	"asset-operator-inbox",
	"lgtm",
	"nats",
	"nats-setup",
	"opensearch",
	"postgres",
	"redis",
	"seaweedfs",
];

for (const ambientProfiles of ["", "admin", "*"]) {
	test(`make infra-start retains dependencies and telemetry without admins under COMPOSE_PROFILES=${ambientProfiles}`, (t) => {
		expect(services(t, "infra-start", ambientProfiles)).toStrictEqual(required);
	});

	test(`make infra-start-admin enables both admin services under COMPOSE_PROFILES=${ambientProfiles}`, (t) => {
		expect(services(t, "infra-start-admin", ambientProfiles)).toStrictEqual(
			[...required, "opensearch-dashboards", "pgadmin"].sort(),
		);
	});
}

test("default application selection omits unused Tags without blocking ingress", () => {
	const result = spawnSync(
		"docker",
		[
			"compose",
			"-f",
			"infra/docker-compose.apps.yml",
			"config",
			"--format",
			"json",
		],
		{ encoding: "utf8", env: { ...process.env, COMPOSE_PROFILES: "" } },
	);
	expect(result.status, result.stderr).toBe(0);
	const { services } = JSON.parse(result.stdout);
	expect(Object.keys(services).sort()).toStrictEqual([
		"asset",
		"caddy",
		"color-extractor",
		"gateway",
		"ingestor",
		"user",
		"variant-generator",
		"wallpaper",
		"web",
	]);
	expect(Object.hasOwn(services.caddy.depends_on, "tags")).toBe(false);
});

test("opting into Tags retains the service without making ingress wait for it", () => {
	const result = spawnSync(
		"docker",
		[
			"compose",
			"-f",
			"infra/docker-compose.apps.yml",
			"--profile",
			"tags",
			"config",
			"--format",
			"json",
		],
		{ encoding: "utf8", env: { ...process.env, COMPOSE_PROFILES: "" } },
	);
	expect(result.status, result.stderr).toBe(0);
	const { services } = JSON.parse(result.stdout);
	expect(services.tags).toBeTruthy();
	expect(Object.hasOwn(services.caddy.depends_on, "tags")).toBe(false);
});
