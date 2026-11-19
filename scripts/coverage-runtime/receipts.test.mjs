import { execFileSync } from "node:child_process";
import { reportInput } from "./report-input.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from "node:fs/promises";
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

test("cross-checkout receipt merge preserves absolute paths inside observed JavaScript bytes", async () => {
	const temporary = await mkdtemp(resolve(tmpdir(), "coverage-portable-"));
	const producer = resolve(temporary, "producer"),
		receiver = resolve(temporary, "receiver");
	try {
		await mkdir(producer);
		await writeFile(
			producer + "/.gitignore",
			".coverage-runtime/\ncoverage/\n",
		);
		const source = "export const value=1;\n";
		await writeFile(producer + "/original.ts", source);
		for (const args of [
			["init", "-q"],
			["add", "."],
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				"commit",
				"-qm",
				"fixture",
			],
		])
			execFileSync("git", args, { cwd: producer });
		const path = producer + "/original.ts",
			synthetic =
				producer +
				"/.coverage-runtime/native-sources-test/" +
				"a".repeat(64) +
				".js";
		const code = `const module = getFactoryModule("file://${producer}/original.js");\n`;
		await mkdir(resolve(synthetic, ".."), { recursive: true });
		await writeFile(synthetic, code);
		const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
		const coverage = (path) => ({
			path,
			statementMap: { 0: loc },
			s: { 0: 1 },
			fnMap: {},
			f: {},
			branchMap: {},
			b: {},
		});
		const original = { [path]: coverage(path) },
			raw = { ...original, [synthetic]: coverage(synthetic) },
			row = { id: "portable-control", workspace: ".", coverage: true };
		const partition = await reportInput(raw, producer, ".");
		await writeReceipt(
			producer + "/coverage/receipts",
			producer,
			row,
			raw,
			original,
			{ [path]: hash(source) },
			[],
			partition.generated,
		);
		await cp(producer, receiver, { recursive: true });
		await mergeReceipts(receiver, [row]);
		const report = JSON.parse(
			await readFile(receiver + "/coverage/coverage-final.json", "utf8"),
		);
		assert.deepEqual(Object.keys(report), [receiver + "/original.ts"]);
		assert.deepEqual(report[receiver + "/original.ts"].s, { 0: 1 });
		const receipt = JSON.parse(
			await readFile(
				receiver + "/coverage/receipts/portable-control.json",
				"utf8",
			),
		);
		const retained = Object.values(receipt.generated)[0];
		assert.equal(
			Buffer.from(retained.sourceBase64, "base64").toString("utf8"),
			code,
			"observed producer JS is opaque, including embedded paths",
		);
		assert.equal(retained.sha256, hash(code));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
