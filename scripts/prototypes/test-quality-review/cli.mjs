// PROTOTYPE #420. Local advisory experiment, deliberately absent from CI.
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepare, truth } from "./corpus.mjs";
import { hash, schema, summarize, validateReview } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) =>
	args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const save = (p, value) =>
	writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
const packetPath = resolve(option("--packet", join(here, "packet.json")));
const command = args[0];
function checkedFiles(packet, fn) {
	for (const c of packet.cases.filter((c) => /^C(?:0[4-9]|1\d)$/.test(c.id))) {
		const directory = mkdtempSync(join(tmpdir(), "test-quality-seed-"));
		try {
			for (const f of c.files.filter((f) =>
				["production", "test", "helper", "fixture"].includes(f.role),
			)) {
				if (f.path.includes("/") || f.path.includes(".."))
					throw new Error("Seed path must be local");
				writeFileSync(join(directory, f.path), f.text);
			}
			fn(c, directory);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
}
function render(packet) {
	const files = (list) =>
		list
			.map(
				(f) =>
					`FILE ${f.path} (${f.role})\n${f.text
						.split("\n")
						.map((line, i) => `${i + 1}: ${line}`)
						.join("\n")}`,
			)
			.join("\n\n");
	return (
		readFileSync(join(here, "rubric.txt"), "utf8") +
		"\n\nShared authoritative standards\n" +
		files(packet.standards ?? []) +
		packet.cases
			.map((c) => `\n\nCASE ${c.id}\nSCOPE ${c.scope}\n${files(c.files)}`)
			.join("\n")
	);
}

try {
	if (command === "prepare") {
		prepare(packetPath);
		console.log(`Frozen packet: ${packetPath}`);
	} else if (command === "controls") {
		let count = 0;
		checkedFiles(load(packetPath), (c, directory) => {
			const r = spawnSync(process.execPath, ["--test", "case.test.mjs"], {
				cwd: directory,
				encoding: "utf8",
				timeout: 5000,
				maxBuffer: 1024 * 1024,
			});
			if (r.status !== 0) throw new Error(`${c.id}: ${r.stderr}\n${r.stdout}`);
			count++;
			console.log(`${c.id}: green`);
		});
		console.log(`${count} seed suites passed`);
	} else if (command === "run") {
		if (!args.includes("--live"))
			throw new Error("run requires --live to authorize model usage");
		const repeats = Number(option("--repeats", "3"));
		if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3)
			throw new Error("Repeats must be 1..3");
		const out = resolve(
			option("--out", join(tmpdir(), `test-quality-review-${Date.now()}`)),
		);
		mkdirSync(out, { recursive: false });
		const packet = load(packetPath);
		const prompt = render(packet);
		if (Buffer.byteLength(prompt) > 250000)
			throw new Error("Input budget exceeded");
		const model = option("--model", "gpt-6.1-sol");
		const binary = process.env.REVIEW_CODEX_BIN ?? "codex";
		const version = spawnSync(binary, ["--version"], {
			encoding: "utf8",
			timeout: 5000,
		}).stdout?.trim();
		save(join(out, "manifest.json"), {
			prototype: 420,
			model,
			effort: "low",
			cli: version,
			repeats,
			packetSha256: hash(readFileSync(packetPath)),
			promptSha256: hash(prompt),
			schemaSha256: hash(JSON.stringify(schema)),
			startedAt: new Date().toISOString(),
			timeoutMs: 180000,
			maxOutputBytes: 2 * 1024 * 1024,
			billing:
				"CLI subscription usage; no per-run invoice or USD rate exposed. Report tokens, not a fabricated dollar price.",
		});
		writeFileSync(join(out, "prompt.txt"), prompt);
		for (let n = 1; n <= repeats; n++) {
			const scratch = mkdtempSync(join(tmpdir(), "test-quality-model-"));
			const started = performance.now();
			const schemaPath = join(scratch, "schema.json");
			const answerPath = join(scratch, "answer.json");
			save(schemaPath, schema);
			// Fixed argv, no shell; no project configuration or repository access needed.
			const argv = [
				"exec",
				"--ignore-user-config",
				"--ignore-rules",
				"--ephemeral",
				"--skip-git-repo-check",
				"-C",
				scratch,
				"-s",
				"read-only",
				"-m",
				model,
				"-c",
				'model_reasoning_effort="low"',
				"-c",
				"features.shell_tool=false",
				"--json",
				"--output-schema",
				schemaPath,
				"-o",
				answerPath,
				"-",
			];
			console.log(`Review ${n}/${repeats} started, 180s deadline`);
			const result = spawnSync(binary, argv, {
				input: prompt,
				encoding: "utf8",
				timeout: 180000,
				maxBuffer: 2 * 1024 * 1024,
			});
			const record = {
				repeat: n,
				elapsedMs: Math.round(performance.now() - started),
				valid: false,
				usage: {},
				findings: [],
			};
			try {
				const events = (result.stdout ?? "")
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line));
				record.usage =
					events.find((e) => e.type === "turn.completed")?.usage ?? {};
				if (result.error || result.status !== 0)
					throw new Error(
						result.error?.message ??
							`Reviewer exit ${result.status}: ${result.stderr?.slice(-2000)}`,
					);
				if (
					events.some(
						(e) =>
							e.item &&
							!["agent_message", "reasoning", "plan"].includes(e.item.type),
					)
				)
					throw new Error("Unexpected tool use; review is packet-only");
				if (
					!Number.isFinite(record.usage.input_tokens) ||
					!Number.isFinite(record.usage.output_tokens)
				)
					throw new Error("Missing usage");
				record.candidateReview = load(answerPath);
				const review = validateReview(record.candidateReview, packet);
				record.findings = review.findings;
				record.valid = true;
			} catch (error) {
				record.error = error.message;
				// Keep raw transport diagnostics private; failed output is never a clean review.
				writeFileSync(
					join(out, `private-error-${n}.log`),
					(result.stderr ?? "") + "\n" + (result.stdout ?? ""),
					{ mode: 0o600 },
				);
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}
			save(join(out, `run-${n}.json`), record);
			console.log(
				`Review ${n}: ${record.valid ? "valid" : "INVALID"}, ${record.elapsedMs}ms, ${record.findings.length} findings`,
			);
			if (!record.valid) throw new Error(record.error);
		}
		console.log(`Results: ${out}`);
	} else if (command === "report") {
		const out = resolve(option("--out", join(here, "results")));
		const runs = readdirSync(out)
			.filter((p) => /^run-\d+\.json$/.test(p))
			.sort()
			.map((p) => load(join(out, p)));
		if (!runs.length || runs.some((r) => !r.valid))
			throw new Error("Report requires completed valid reviews");
		const judgments = load(
			resolve(option("--judgments", join(here, "judgments.json"))),
		);
		const result = summarize(runs, judgments, truth);
		save(join(out, "summary.json"), result);
		console.log(JSON.stringify(result, null, 2));
	} else
		throw new Error(
			"Use prepare | controls | run --live --out DIR | report --out DIR [--judgments FILE]",
		);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
