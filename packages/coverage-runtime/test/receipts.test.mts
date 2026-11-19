import { receiptSchema } from "../src/json.mjs";
import { expect } from "vitest";
import { repositoryRoot } from "../src/repository-root.mjs";

import { execFileSync } from "node:child_process";
import { reportInput } from "../src/report-input.mjs";
import { test } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { hash, writeReceipt, mergeReceipts } from "../src/receipts.mjs";
const root = repositoryRoot();
test("merge requires every selected tier and rejects changed source/raw/published evidence", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "coverage-receipts-"));
	const path = resolve(root, "packages/coverage-runtime/dist/receipts.mjs"),
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
	const row = {
		id: "control",
		workspace: "packages/coverage-runtime",
		coverage: true,
	};
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
		const original = await readFile(`${directory}/control.json`, "utf8");
		await mergeReceipts(root, [row], directory, `${directory}/output`);
		const published = JSON.parse(
			await readFile(`${directory}/output/coverage-final.json`, "utf8"),
		);
		expect(published[path].s).toStrictEqual({ 0: 2 });
		await expect(
			mergeReceipts(
				root,
				[row, { ...row, id: "missing" }],
				directory,
				`${directory}/output`,
			),
		).rejects.toThrow(/Incomplete/);
		for (const [key, value, pattern] of [
			["revision", "outdated", /revision changed/],
			["reportHash", "changed", /Published coverage changed/],
			["rawHash", "changed", /Raw coverage changed/],
		] as const) {
			const receipt = JSON.parse(original);
			receipt[key] = value;
			await writeFile(`${directory}/control.json`, JSON.stringify(receipt));
			await expect(
				mergeReceipts(root, [row], directory, `${directory}/output`),
			).rejects.toThrow(pattern);
		}
		const receipt = JSON.parse(original);
		receipt.sourceHashes["packages/coverage-runtime/dist/receipts.mjs"] = "old";
		await writeFile(`${directory}/control.json`, JSON.stringify(receipt));
		await expect(
			mergeReceipts(root, [row], directory, `${directory}/output`),
		).rejects.toThrow(/source changed/);
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
			`${producer}/.gitignore`,
			".coverage-runtime/\ncoverage/\n",
		);
		const source = "export const value=1;\n";
		await writeFile(`${producer}/original.ts`, source);
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
		const path = `${producer}/original.ts`,
			synthetic =
				producer +
				"/.coverage-runtime/native-sources-test/" +
				"a".repeat(64) +
				".js";
		const code = `const module = getFactoryModule("file://${producer}/original.js");\n`;
		await mkdir(resolve(synthetic, ".."), { recursive: true });
		await writeFile(synthetic, code);
		const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
		const coverage = (path: string) => ({
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
			`${producer}/coverage/receipts`,
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
			await readFile(`${receiver}/coverage/coverage-final.json`, "utf8"),
		);
		expect(Object.keys(report)).toStrictEqual([`${receiver}/original.ts`]);
		expect(report[`${receiver}/original.ts`].s).toStrictEqual({ 0: 1 });
		const receipt = JSON.parse(
			await readFile(
				`${receiver}/coverage/receipts/portable-control.json`,
				"utf8",
			),
		);
		const retained = Object.values(receiptSchema.parse(receipt).generated)[0];
		expect(
			Buffer.from(retained.sourceBase64, "base64").toString("utf8"),
			"observed producer JS is opaque, including embedded paths",
		).toBe(code);
		expect(retained.sha256).toBe(hash(code));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
