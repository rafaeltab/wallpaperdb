import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, writeReceipt, mergeReceipts } from "./receipts.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
test("merge requires every selected tier and rejects changed source/raw/published evidence", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "coverage-receipts-"));
	const path = resolve(root, "scripts/coverage-runtime/receipts.mjs"),
		loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
	const data = {
		[path]: {
			path,
			statementMap: { 0: loc },
			s: { 0: 2 },
			fnMap: {},
			f: {},
			branchMap: {},
			b: {},
		},
	};
	const row = { id: "control", workspace: "scripts", coverage: true };
	try {
		await writeReceipt(
			directory,
			root,
			row,
			data,
			data,
			{ [path]: hash(await readFile(path)) },
			[],
		);
		const original = await readFile(directory + "/control.json", "utf8");
		await mergeReceipts(root, [row], directory, directory + "/output");
		const published = JSON.parse(
			await readFile(directory + "/output/coverage-final.json", "utf8"),
		);
		assert.deepEqual(published[path].s, { 0: 2 });
		await assert.rejects(
			mergeReceipts(
				root,
				[row, { ...row, id: "missing" }],
				directory,
				directory + "/output",
			),
			/Incomplete/,
		);
		for (const [key, value, pattern] of [
			["revision", "outdated", /revision changed/],
			["reportHash", "changed", /Published coverage changed/],
			["rawHash", "changed", /Raw coverage changed/],
		]) {
			const receipt = JSON.parse(original);
			receipt[key] = value;
			await writeFile(directory + "/control.json", JSON.stringify(receipt));
			await assert.rejects(
				mergeReceipts(root, [row], directory, directory + "/output"),
				pattern,
			);
		}
		const receipt = JSON.parse(original);
		receipt.sourceHashes["scripts/coverage-runtime/receipts.mjs"] = "old";
		await writeFile(directory + "/control.json", JSON.stringify(receipt));
		await assert.rejects(
			mergeReceipts(root, [row], directory, directory + "/output"),
			/source changed/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
