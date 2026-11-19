import type {
	Report,
	SourceIdentities,
	TierIdentity,
	AuditEntry,
	GeneratedSources,
	Receipt,
	ReportInput,
	AuditPolicy,
} from "./contract.mjs";
import { reportInput } from "./report-input.mjs";
import { checkoutIdentity } from "./artifacts.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { coverageMap, publishReports } from "./publish-reports.mjs";
import { auditReports } from "./report-audit.mjs";
export const hash = (bytes: string | Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const portable = <T,>(value: T, root: string): T =>
	JSON.parse(
		JSON.stringify(value).replaceAll(root.replace(/\/$/, "") + "/", "$ROOT/"),
	);
const restored = <T,>(value: T, root: string): T =>
	JSON.parse(
		JSON.stringify(value).replaceAll("$ROOT/", root.replace(/\/$/, "") + "/"),
	);
export const revision = (root: string) =>
	execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
export async function writeReceipt(
	directory: string,
	root: string,
	row: TierIdentity,
	raw: Report | null,
	data: Report | null,
	sourceHashes: SourceIdentities,
	audit: AuditEntry[],
	generated: GeneratedSources = {},
) {
	await mkdir(directory, { recursive: true });
	const receipt: Receipt = {
		reportHash: "",
		rawHash: "",
		identity: checkoutIdentity(root),
		id: row.id,
		revision: revision(root),
		coverage: row.coverage,
		passed: true,
		workspace: row.workspace,
		sourceHashes: Object.fromEntries(
			Object.entries(sourceHashes).map(([path, sha]) => [
				relative(root, path),
				sha,
			]),
		),
		raw: portable(raw, root),
		data: portable(data, root),
		audit: portable(audit, root),
		generated: Object.fromEntries(
			Object.entries(generated).map(([path, { source, ...entry }]) => [
				portable(path, root),
				{
					...portable(entry, root),
					sourceBase64: Buffer.from(source, "utf8").toString("base64"),
				},
			]),
		),
	};
	receipt.reportHash = hash(JSON.stringify(receipt.data));
	receipt.rawHash = hash(JSON.stringify(receipt.raw));
	await writeFile(
		resolve(directory, row.id + ".json"),
		JSON.stringify(receipt),
	);
}
export async function mergeReceipts(
	root: string,
	expected: TierIdentity[],
	directory = resolve(root, "coverage/receipts"),
	output = resolve(root, "coverage"),
	policy: AuditPolicy = {},
) {
	await mkdir(output, { recursive: true });
	for (const name of await readdir(output))
		if (!["receipts", ".crap-lock"].includes(name))
			await rm(resolve(output, name), { recursive: true, force: true });
	const names = await readdir(directory),
		combined = coverageMap({}),
		audit: AuditEntry[] = [],
		workspaces = new Set();
	assert.deepEqual(
		names.filter((n) => n.endsWith(".json")).sort(),
		expected.map((r) => r.id + ".json").sort(),
		"Incomplete or unexpected coverage receipts",
	);
	const identity = checkoutIdentity(root);
	const inputs: ReportInput[] = [],
		receipts: Receipt[] = [];
	for (const row of expected) {
		const receipt: Receipt = JSON.parse(
			await readFile(resolve(directory, row.id + ".json"), "utf8"),
		);
		assert.equal(
			receipt.identity,
			identity,
			"Checkout changed since coverage generation",
		);
		assert.equal(receipt.id, row.id);
		assert.equal(receipt.workspace, row.workspace);
		assert.equal(receipt.coverage, row.coverage);
		assert.equal(receipt.passed, true);
		assert.equal(receipt.revision, revision(root), "Coverage revision changed");
		assert.equal(
			hash(JSON.stringify(receipt.raw)),
			receipt.rawHash,
			"Raw coverage changed",
		);
		assert.equal(
			hash(JSON.stringify(receipt.data)),
			receipt.reportHash,
			"Published coverage changed",
		);
		for (const [path, expectedHash] of Object.entries(receipt.sourceHashes)) {
			assert.ok(
				!path.startsWith("..") && !path.startsWith("/"),
				"Invalid source identity path",
			);
			assert.equal(
				hash(await readFile(resolve(root, path))),
				expectedHash,
				`Coverage source changed: ${path}`,
			);
		}
		if (row.coverage) {
			assert.ok(receipt.raw, "Missing raw coverage");
			const { original } = await reportInput(
				restored(receipt.raw, root),
				root,
				row.workspace,
				Object.fromEntries(
					Object.entries(restored(receipt.generated || {}, root)).map(
						([path, { sourceBase64, ...entry }]) => {
							assert.equal(
								typeof sourceBase64,
								"string",
								"Missing opaque generated source",
							);
							return [
								path,
								{
									...entry,
									source: Buffer.from(sourceBase64, "base64").toString("utf8"),
								},
							];
						},
					),
				),
			);
			inputs.push({ id: row.id, data: original });
			receipts.push(receipt);
		}
		workspaces.add(receipt.workspace);
	}
	const audited = auditReports(inputs, root, policy);
	for (let i = 0; i < receipts.length; i++) {
		const receipt = receipts[i];
		assert.deepEqual(
			audited.reports[i].data,
			restored(receipt.data, root),
			"Published coverage differs from audited raw input",
		);
		const entries = audited.audit.filter(
			(entry) => entry.report === receipt.id,
		);
		assert.deepEqual(
			entries,
			restored(receipt.audit, root),
			"Coverage audit changed",
		);
		for (const path of Object.keys(audited.reports[i].data))
			assert.ok(
				receipt.sourceHashes[relative(root, path)],
				`Missing source identity: ${path}`,
			);
		combined.merge(coverageMap(audited.reports[i].data));
		audit.push(...entries);
	}
	await publishReports(combined.toJSON(), output);
	await writeFile(
		resolve(output, "compiled-manifest.json"),
		JSON.stringify({
			workspaces: [...workspaces],
			audit,
			reports: expected.map((r) => r.id),
		}),
	);
}
