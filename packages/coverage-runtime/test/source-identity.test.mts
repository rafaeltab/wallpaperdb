import { expect } from "vitest";

import { createHash } from "node:crypto";

import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { verifySourceIdentity } from "../src/command.mjs";

import { test } from "vitest";
test("source-identity preserves the coverage contract", async () => {
	const directory = await mkdtemp(join(tmpdir(), "coverage-source-"));
	try {
		const path = join(directory, "original.ts");
		const compiledSource = "export const value = 1;\n";
		const capturedHash = createHash("sha256")
			.update(compiledSource)
			.digest("hex");
		const snapshot = { [path]: capturedHash };
		await writeFile(path, compiledSource);
		expect(await verifySourceIdentity(path, snapshot)).toBe(capturedHash);
		await writeFile(path, "export const value = 2;\n");
		await expect(verifySourceIdentity(path, snapshot)).rejects.toThrow(
			/source changed since compilation/,
		);
		await writeFile(path, compiledSource);
		expect(
			await verifySourceIdentity(path, snapshot),
			"unchanged source stays supported",
		).toBe(capturedHash);
		await expect(verifySourceIdentity(path, {})).rejects.toThrow(
			/Missing compiled source identity/,
		);
		console.log(
			"Report source identity is bound to compiled bytes; edits and missing provenance fail",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
