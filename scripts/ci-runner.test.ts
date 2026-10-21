import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");

function runCi(force: string, failingStage: string) {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-ci-test-"));
	try {
		writeFileSync(join(directory, "Makefile"), makefile);
		mkdirSync(join(directory, "scripts/lib"), { recursive: true });
		for (const name of ["docker-validation.mjs", "lib/docker-queue.mjs"]) {
			cpSync(new URL(name, import.meta.url), join(directory, "scripts", name));
		}
		writeFileSync(
			join(directory, "turbo"),
			`#!/bin/sh
stage=workspace
case "$*" in *test:e2e*) stage=e2e ;; esac
echo "$stage" >> "$CI_TEST_LOG"
test "$stage" != "$CI_TEST_FAILURE"
`,
			{ mode: 0o700 },
		);
		writeFileSync(
			join(directory, "pnpm"),
			`#!/bin/sh
echo coverage >> "$CI_TEST_LOG"
test coverage != "$CI_TEST_FAILURE"
`,
			{ mode: 0o700 },
		);
		const log = join(directory, "calls.log");
		writeFileSync(log, "");
		const result = spawnSync(
			"make",
			[
				"--no-print-directory",
				"ci",
				`FORCE=${force}`,
				`TURBO=${join(directory, "turbo")}`,
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 10_000,
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					MAKEFLAGS: "",
					MFLAGS: "",
					CI_TEST_LOG: log,
					DOCKER_VALIDATION_LOCK_FILE: join(directory, "host.lock"),
					DOCKER_VALIDATION_TIMEOUT: "5",
					CI_TEST_FAILURE: failingStage,
				},
			},
		);
		if (result.error) throw result.error;
		return {
			status: result.status,
			output: `${result.stdout}${result.stderr}`,
			calls: readFileSync(log, "utf8").trim().split("\n"),
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe.each(["", "1"])("ci FORCE=%s failure propagation", (force) => {
	it.each([
		{ stage: "workspace", calls: ["workspace"] },
		{ stage: "coverage", calls: ["workspace", "coverage"] },
	])("stops after $stage fails and does not report success", ({
		stage,
		calls,
	}) => {
		const result = runCi(force, stage);
		expect(result.status).not.toBe(0);
		expect(result.calls).toEqual(calls);
		expect(result.output).not.toContain("All local CI checks passed");
		expect(result.output).not.toContain("Coverage report:");
	});

	it("reports success only after every stage succeeds", () => {
		const result = runCi(force, "none");
		expect(result.status).toBe(0);
		expect(result.calls).toEqual(["workspace", "coverage"]);
		expect(result.output).toMatch(/All local CI checks passed in \d+s/);
		expect(result.output).toContain("Coverage report: coverage/lcov.info");
		expect(result.output).toContain("E2E excluded");
		expect(result.output).toContain("make test-e2e");
	});
});
