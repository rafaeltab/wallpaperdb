// Compatibility replay after the independent delegated-yield red/green slice.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const input = JSON.parse(
	(await readFile("/tmp/wallpaperdb-742/hillclimb/recovery-live.jsonl", "utf8"))
		.trim()
		.split("\n")[0],
);
for (const [variant, expected, entry] of [
	["original-converter", [12, -10], 2],
	["converter", [12, 1], 13],
]) {
	const { default: convert } = await import(
		`../../.coverage-experiment/${variant}.mjs`
	);
	const result = await convert(structuredClone(input));
	const c = Object.values(result)[0];
	const branch = Object.keys(c.branchMap).find(
		(id) =>
			c.branchMap[id].type === "if" && c.branchMap[id].loc.start.line === 30,
	);
	assert.deepEqual(c.b[branch], expected);
	const statement = Object.keys(c.statementMap).find(
		(id) => c.statementMap[id].start.line === 30,
	);
	assert.equal(c.s[statement], entry);
	console.log(
		variant,
		"recovery.ts:30",
		c.b[branch],
		"statement",
		c.s[statement],
	);
}
