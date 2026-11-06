import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create547Preparation } from "./lib/boat-547-preparation.mjs";
import { captureCommand } from "./lib/boat-capture.mjs";
import {
	preparationFixture,
	publicPreparationFixture,
} from "./test-fixtures/547-preparation.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mono = () => Number(process.hrtime.bigint()) / 1e9;
const metadata = json(
	path.join(repository, "scripts/test-fixtures/547-nkeys-metadata-v2.json"),
);

// The historical native patch is independent of the maintained edit evaluator.
// Its original accepted result stays a v1 neighbor, never a new runtime result.
function reference(f) {
	const initial = fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"));
	const native = json(
		path.join(repository, "scripts/test-fixtures/547-preparation.json"),
	);
	assert.equal(
		spawnSync("patch", ["--silent", "-p1"], {
			cwd: f.root,
			input: native.lockDiff,
			timeout: 5000,
		}).status,
		0,
	);
	const historical = fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"));
	assert.equal(
		hash(historical),
		"b61c53e5735c14c9e4edae2bef7199cfd7ba858cd537b737f52e86a047c58c02",
	);
	const anchor = `  ${metadata.name}@${metadata.version}:\n    resolution: {integrity: ${metadata.dist.integrity}}\n    engines: {node: '${metadata.engines.node}'}\n`;
	assert.equal(historical.toString().split(anchor).length, 2);
	const line = `    deprecated: '${metadata.deprecated}'\n`;
	const current = Buffer.from(
		historical.toString().replace(anchor, anchor + line),
	);
	fs.writeFileSync(path.join(f.root, "pnpm-lock.yaml"), initial);
	return { initial, historical, current, anchor, line };
}

test("547 lock v2 accepts only the independently constructed complete reference", (t) => {
	const f = preparationFixture(t, true);
	const refs = reference(f);
	const workload = create547Preparation(f.root);
	const evidence = path.join(f.root, "lock-result");
	fs.mkdirSync(evidence);
	fs.writeFileSync(path.join(f.root, "pnpm-lock.yaml"), refs.current);
	const result = workload.acceptGenerated(evidence);
	assert.equal(result.lockVersion, 2);
	assert.equal(result.bytes, refs.historical.length + 106);
	assert.equal(result.sha256, hash(refs.current));
	assert.equal(result.approvedChanges["peer-context"], 3);
	assert.equal(result.approvedChanges["native-deprecation"], 17);
	assert.equal(result.approvedChanges["registry-deprecation-v2"], 1);
	assert.equal(workload.acceptNoop().unchanged, true);
});

const invalid = {
	"old-contract output": (r) => r.historical,
	"unchanged input": (r) => r.initial,
	"Vitest peer context": (r) =>
		r.current
			.toString()
			.replace(
				"      vitest: 5.0.2(@opentelemetry/api@1.9.0)(@types/node@22.19.3)",
				"      vitest: 5.0.2(@opentelemetry/api@1.9.0)(@types/node@26.0.1)",
			),
	"dependency edge": (r) =>
		r.current
			.toString()
			.replace("      tweetnacl: 1.0.3", "      tweetnacl: 1.0.4"),
	integrity: (r) =>
		r.current
			.toString()
			.replace(
				metadata.dist.integrity,
				metadata.dist.integrity.replace("sha512-tB", "sha512-uB"),
			),
	"nats patch hash": (r) =>
		r.current.toString().replace("    hash: 6991af2b", "    hash: 7991af2b"),
	"unrelated metadata": (r) =>
		r.current
			.toString()
			.replace(
				"deprecated: Use @opentelemetry/sdk-trace package",
				"deprecated: a different description",
			),
	"wrong package": (r) =>
		r.current
			.toString()
			.replace(r.anchor + r.line, r.anchor)
			.replace(
				"  node-domexception@1.0.0:\n",
				"  node-domexception@1.0.0:\n" + r.line,
			),
	"wrong value": (r) =>
		r.current
			.toString()
			.replace(metadata.deprecated, "Package moved elsewhere"),
	"wrong location": (r) =>
		r.current
			.toString()
			.replace(r.anchor + r.line, r.anchor)
			.replace(
				"  nkeys.js@1.1.0:\n    dependencies:",
				"  nkeys.js@1.1.0:\n" + r.line + "    dependencies:",
			),
	"missing record": (r) => r.current.toString().replace(r.anchor + r.line, ""),
	"extra record": (r) =>
		r.current
			.toString()
			.replace(
				"snapshots:\n",
				"  unrelated@1.0.0:\n    resolution: {integrity: unexpected}\n\nsnapshots:\n",
			),
};

for (const [name, change] of Object.entries(invalid)) {
	test(`547 lock v2 refuses ${name} without acknowledging generated inputs`, (t) => {
		const f = preparationFixture(t, true);
		const refs = reference(f);
		const workload = create547Preparation(f.root);
		const bytes = Buffer.from(change(refs));
		assert.equal(
			bytes.equals(refs.current),
			false,
			"Control must change the valid neighbor",
		);
		fs.writeFileSync(path.join(f.root, "pnpm-lock.yaml"), bytes);
		const evidence = path.join(f.root, "lock-result");
		fs.mkdirSync(evidence);
		assert.throws(
			() => workload.acceptGenerated(evidence),
			/Complete generated lock differs/,
		);
		assert.deepEqual(fs.readdirSync(evidence), []);
		assert.ok(
			fs.readFileSync(path.join(f.root, "pnpm-lock.yaml")).equals(bytes),
		);
		// Refusal must not replace the frozen expectation with rejected bytes.
		if (name !== "unchanged input")
			assert.throws(() => workload.verify(), /Frozen workload changed/);
	});
}

if (process.env.BOAT_547_QUALIFIED_CLI) {
	for (const variant of ["current", "historical", "noop-drift"]) {
		test(`547 lock v2 public Make captures acceptance and cleanup, ${variant}`, {
			timeout: 30000,
		}, async (t) => {
			const f = await publicPreparationFixture(
				t,
				process.env.BOAT_547_QUALIFIED_CLI,
			);
			f.config.until = "images";
			if (variant === "historical") f.env.CONTROL_LOCK_METADATA_VERSION = "1";
			if (variant === "noop-drift") f.env.CONTROL_LOCK_NOOP_DRIFT = "1";
			const refs = reference(f);
			const config = path.join(f.root, "config.json");
			fs.writeFileSync(config, JSON.stringify(f.config));
			const make = execFileSync("which", ["make"], { encoding: "utf8" }).trim();
			const captureDirectory = path.join(f.root, "public-lock-capture");
			const capture = await captureCommand({
				argv: [make, "boat-hillclimb-547", `BOAT_HILLCLIMB_CONFIG=${config}`],
				cwd: f.root,
				env: f.env,
				directory: captureDirectory,
				deadline: mono() + 25,
				disposalMs: 2000,
			});
			assert.equal(capture.captureComplete, true);
			const disposal = json(path.join(captureDirectory, "disposal.json"));
			assert.deepEqual(disposal.unresolved, []);
			assert.equal(disposal.pipesClosed, true);
			const result = json(
				path.join(f.config.evidence, "preparation-result.json"),
			);
			const generated = json(
				path.join(f.config.evidence, "generate/result.json"),
			);
			assert.deepEqual(
				json(path.join(f.config.evidence, "generate/command/receipt.json"))
					.terminal,
				{ code: 0, signal: null },
			);
			if (variant === "current") {
				assert.equal(
					capture.terminal.code,
					0,
					fs.readFileSync(path.join(captureDirectory, "stderr.raw"), "utf8"),
				);
				assert.equal(result.status, "PASS_PREDEV_THROUGH_IMAGES");
				assert.equal(generated.outcome.lockVersion, 2);
				assert.equal(generated.outcome.sha256, hash(refs.current));
				assert.ok(
					fs
						.readFileSync(path.join(f.root, "pnpm-lock.yaml"))
						.equals(refs.current),
				);
				const noop = result.phases.find((p) => p.phase === "noop");
				assert.equal(noop.outcome.unchanged, true);
				const observed = result.phases.find(
					(p) => p.phase === "metadata",
				).outcome;
				assert.equal(observed.rootLock.sha256, hash(refs.current));
			} else {
				assert.equal(capture.terminal.code, 2);
				assert.equal(result.status, "FAIL");
				assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
				assert.match(
					result.error,
					variant === "historical"
						? /Complete generated lock differs/
						: /Noop generator changed lock bytes/,
				);
				assert.equal(
					fs.existsSync(
						path.join(
							f.config.evidence,
							variant === "historical" ? "frozen" : "green-user",
						),
					),
					false,
				);
				const commands = fs
					.readFileSync(path.join(f.root, "commands.jsonl"), "utf8")
					.trim()
					.split("\n")
					.map(JSON.parse);
				assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
			}
			t.diagnostic(
				JSON.stringify({
					variant,
					terminal: capture.terminal,
					status: result.status,
					generated: generated.status,
					outcome: generated.outcome,
					cleanup: result.cleanup,
				}),
			);
		});
	}
}
