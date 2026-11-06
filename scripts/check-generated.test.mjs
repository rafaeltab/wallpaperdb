import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkGenerated } from "./check-generated.mjs";
test("generation verifies artifacts without changing the source checkout", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, "artifact.txt"), "correct");
	const generate = (directory) =>
		fs.writeFileSync(path.join(directory, "artifact.txt"), "correct");
	assert.deepEqual(checkGenerated(root, ["artifact.txt"], generate), []);
	fs.writeFileSync(path.join(root, "artifact.txt"), "stale");
	assert.ok(
		checkGenerated(root, ["artifact.txt"], generate).some((e) =>
			e.includes("stale"),
		),
	);
	assert.equal(
		fs.readFileSync(path.join(root, "artifact.txt"), "utf8"),
		"stale",
	);
	const unstable = (directory) =>
		fs.appendFileSync(path.join(directory, "artifact.txt"), "!");
	assert.ok(
		checkGenerated(root, ["artifact.txt"], unstable).some((e) =>
			e.includes("deterministic"),
		),
	);
});
