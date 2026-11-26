// Retained red diagnostic of the unguarded native provider, not acceptance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const report = JSON.parse(
	await readFile(
		"/tmp/wallpaperdb-742/adoption/native-app-mock-false-hit-report/coverage-final.json",
		"utf8",
	),
);
const [, file] =
	Object.entries(report).find(([name]) =>
		name.endsWith("/fixtures/mock-target.ts"),
	) ?? [];
assert.ok(file);
assert.deepEqual(
	Object.values(file.s),
	[0],
	"original application body never executed",
);
assert.deepEqual(
	Object.values(file.f),
	[0],
	"original application function never called",
);
