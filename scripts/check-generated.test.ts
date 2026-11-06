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
