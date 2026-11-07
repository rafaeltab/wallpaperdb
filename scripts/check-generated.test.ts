import { execFileSync } from "node:child_process";
import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { checkGenerated } from "./check-generated.ts";
test("generation verifies artifacts without changing the source checkout", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, "artifact.txt"), "correct");
	const generate = (directory: string) =>
		fs.writeFileSync(path.join(directory, "artifact.txt"), "correct");
	expect(checkGenerated(root, ["artifact.txt"], generate)).toStrictEqual([]);
	fs.writeFileSync(path.join(root, "artifact.txt"), "stale");
	expect(
		checkGenerated(root, ["artifact.txt"], generate).some((e) =>
			e.includes("stale"),
		),
	).toBeTruthy();
	expect(fs.readFileSync(path.join(root, "artifact.txt"), "utf8")).toBe(
		"stale",
	);
	const unstable = (directory: string) =>
		fs.appendFileSync(path.join(directory, "artifact.txt"), "!");
	expect(
		checkGenerated(root, ["artifact.txt"], unstable).some((e) =>
			e.includes("deterministic"),
		),
	).toBeTruthy();
});

test("generation preserves pnpm executable paths in a temporary workspace", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated bin 'quoted-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	const workspace = path.join(root, "apps/example");
	const bin = path.join(workspace, "node_modules/.bin");
	fs.mkdirSync(bin, { recursive: true });
	fs.writeFileSync(path.join(workspace, "artifact.txt"), "correct");
	fs.writeFileSync(
		path.join(root, "generator.ts"),
		'import {writeFileSync} from "node:fs"; writeFileSync("artifact.txt", "correct");',
	);
	fs.writeFileSync(
		path.join(bin, "generate"),
		'#!/bin/sh\nbasedir=$(dirname "$0")\nexec node "$basedir/../../../../generator.ts" "$@"\n',
		{ mode: 0o755 },
	);
	expect(
		checkGenerated(workspace, ["artifact.txt"], (directory) => {
			fs.writeFileSync(path.join(directory, "artifact.txt"), "stale");
			execFileSync(path.join(directory, "node_modules/.bin/generate"), [], {
				cwd: directory,
				stdio: "pipe",
			});
		}),
	).toStrictEqual([]);
	expect(fs.readFileSync(path.join(workspace, "artifact.txt"), "utf8")).toBe(
		"correct",
	);
});

test("build-generated outputs may be absent or stale but must be produced deterministically", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-untracked-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	const artifact = path.join(root, "artifact.txt");
	const generate = (directory: string) =>
		fs.writeFileSync(path.join(directory, "artifact.txt"), "correct");
	expect(
		checkGenerated(root, ["artifact.txt"], generate, { committed: false }),
	).toStrictEqual([]);
	expect(fs.existsSync(artifact)).toBe(false);
	expect(
		checkGenerated(root, ["artifact.txt"], generate).some((e) =>
			e.includes("stale"),
		),
	).toBe(true);
	fs.writeFileSync(artifact, "stale");
	expect(
		checkGenerated(root, ["artifact.txt"], generate, { committed: false }),
	).toStrictEqual([]);
	expect(fs.readFileSync(artifact, "utf8")).toBe("stale");
	fs.rmSync(artifact);
	expect(
		checkGenerated(
			root,
			["artifact.txt"],
			(directory) =>
				fs.appendFileSync(path.join(directory, "artifact.txt"), "!"),
			{ committed: false },
		).some((e) => e.includes("deterministic")),
	).toBe(true);
	expect(
		checkGenerated(root, ["artifact.txt"], () => {}, { committed: false }).some(
			(e) => e.includes("missing generated"),
		),
	).toBe(true);
});
