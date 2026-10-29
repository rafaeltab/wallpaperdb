import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";

/** Private, bounded observations of this installed native runner, never outcomes. */
function nativeEvidence(file, runner) {
	const totalLimit = 8 * 1024 * 1024,
		recordLimit = 256 * 1024,
		healthReserve = 4096;
	const issues = new Set(),
		pending = new Set();
	let bytes = 0,
		entries = 0,
		completions = 0,
		opened = false,
		stopped = false;
	try {
		// Refuse a previous worker's file. Missing call joins make restarts incomplete.
		writeFileSync(file, "", { flag: "wx", mode: 0o600 });
		opened = true;
	} catch {
		issues.add("open-failed");
		stopped = true;
	}
	function record(value, terminal = false) {
		if (!opened || (stopped && !terminal)) return;
		try {
			const line = `${JSON.stringify(value)}\n`;
			const size = Buffer.byteLength(line);
			const limit = totalLimit - (terminal ? 0 : healthReserve);
			if ((terminal && size > healthReserve) || bytes + size > limit) {
				issues.add(
					terminal && size > healthReserve ? "record-limit" : "total-limit",
				);
				stopped = true;
				return;
			}
			if (size <= recordLimit) {
				appendFileSync(file, line);
				bytes += size;
				return;
			}
			// Only an existing allowlisted call event can use the framing format.
			if (
				terminal ||
				!["entry", "end"].includes(value.event) ||
				!["dryRun", "mutantRun"].includes(value.method) ||
				typeof value.id !== "string" ||
				Buffer.byteLength(value.id) > 128
			) {
				issues.add("record-limit");
				stopped = true;
				return;
			}
			// The raw-byte lower-bound check above precedes the additional buffer.
			const payload = Buffer.from(line, "utf8");
			const chunkBytes = 96 * 1024;
			const parts = Math.ceil(size / chunkBytes);
			const sha256 = createHash("sha256").update(payload).digest("hex");
			function part(index) {
				const data = payload
					.subarray(index * chunkBytes, (index + 1) * chunkBytes)
					.toString("base64");
				const text = `${JSON.stringify({
					event: "fragment",
					version: 1,
					id: value.id,
					method: value.method,
					originalEvent: value.event,
					index,
					parts,
					logicalBytes: size,
					sha256,
					encoding: "base64",
					data,
				})}\n`;
				const length = Buffer.byteLength(text);
				if (length > recordLimit || length - data.length > 2048)
					throw new Error("Capture fragment exceeds its bounds");
				return { text, length };
			}
			// Preflight the complete physical encoding before appending any part.
			let physicalBytes = 0;
			for (let index = 0; index < parts; index++) {
				physicalBytes += part(index).length;
				if (bytes + physicalBytes > limit) {
					issues.add("total-limit");
					stopped = true;
					return;
				}
			}
			// Regenerate one bounded part at a time; do not retain a parts array.
			for (let index = 0; index < parts; index++) {
				const { text, length } = part(index);
				appendFileSync(file, text);
				bytes += length;
			}
		} catch {
			issues.add("serialization-or-write-failed");
			stopped = true;
		}
	}
	// Only these explicitly selected scalar fields may reach the evidence file.
	function fields(value, names) {
		return Object.fromEntries(
			names.map((name) => {
				const item = value?.[name];
				if (
					item !== null &&
					item !== undefined &&
					typeof item !== "string" &&
					typeof item !== "boolean" &&
					!(typeof item === "number" && Number.isFinite(item))
				)
					throw new Error("Non-scalar evidence");
				return [name, item];
			}),
		);
	}
	function strings(value) {
		if (value === undefined) return undefined;
		if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
			throw new Error("Invalid test identifiers");
		return [...value];
	}
	function counts(value) {
		if (!value || typeof value !== "object")
			throw new Error("Missing coverage counts");
		return Object.fromEntries(
			Object.entries(value).map(([id, count]) => {
				if (typeof count !== "number" || !Number.isFinite(count) || count < 0)
					throw new Error("Invalid coverage count");
				return [id, count];
			}),
		);
	}
	function observe(build, terminal = false) {
		if (stopped && !terminal) return;
		try {
			build();
		} catch {
			issues.add("observation-failed");
			stopped = true;
		}
	}
	function hitCount() {
		try {
			if (typeof runner.readHitCount === "function") {
				// Private in the pinned plugin's declaration; no ctx/global traversal.
				const value = runner.readHitCount();
				if (Number.isFinite(value) && value >= 0)
					return { state: "observed", value };
			}
		} catch {
			/* The native result must survive a failed observation. */
		}
		issues.add("hit-count-unavailable");
		return { state: "unavailable" };
	}
	return {
		entry(id, method, args) {
			pending.add(id);
			entries++;
			observe(() => {
				const options = args[0];
				const common = fields(options, ["timeout", "disableBail"]);
				let optionsRecord;
				if (method === "dryRun") {
					optionsRecord = {
						...common,
						...fields(options, ["coverageAnalysis"]),
						files: strings(options?.files),
						testFiles: strings(options?.testFiles),
					};
				} else {
					const mutant = options?.activeMutant;
					optionsRecord = {
						...common,
						...fields(options, [
							"mutantActivation",
							"reloadEnvironment",
							"sandboxFileName",
							"hitLimit",
						]),
						testFilter: strings(options?.testFilter),
						testFilterProvided: options?.testFilter !== undefined,
						activeMutant: {
							...fields(mutant, [
								"id",
								"fileName",
								"mutatorName",
								"replacement",
							]),
							location: {
								start: fields(mutant?.location?.start, ["line", "column"]),
								end: fields(mutant?.location?.end, ["line", "column"]),
							},
						},
					};
				}
				record({ event: "entry", id, method, options: optionsRecord });
			});
		},
		end(id, method, result, threw, error) {
			pending.delete(id);
			completions++;
			observe(() => {
				if (threw) {
					if (method === "mutantRun") issues.add("hit-count-unavailable");
					record({
						event: "end",
						id,
						method,
						threw: true,
						exception: fields(error, ["name", "message"]),
						...(method === "mutantRun"
							? { hitCount: { state: "unavailable" } }
							: {}),
					});
					return;
				}
				const output = fields(result, [
					"status",
					"errorMessage",
					"reason",
					"failureMessage",
					"nrOfTests",
				]);
				if (method === "dryRun") {
					output.tests = result.tests?.map((test) =>
						fields(test, [
							"id",
							"name",
							"fileName",
							"status",
							"timeSpentMs",
							"failureMessage",
						]),
					);
					if (result.mutantCoverage) {
						output.mutantCoverage = {
							static: counts(result.mutantCoverage.static),
							perTest: Object.fromEntries(
								Object.entries(result.mutantCoverage.perTest).map(
									([id, hits]) => [id, counts(hits)],
								),
							),
						};
					} else {
						issues.add("dry-run-coverage-unavailable");
						output.mutantCoverage = null;
					}
				} else output.killedBy = strings(result.killedBy);
				record({
					event: "end",
					id,
					method,
					threw: false,
					result: output,
					...(method === "mutantRun" ? { hitCount: hitCount() } : {}),
				});
			});
		},
		finish(disposal) {
			observe(() => {
				if (disposal !== "returned") issues.add(disposal);
				record(
					{
						event: "health",
						pid: process.pid,
						complete: issues.size === 0 && pending.size === 0,
						issues: [...issues],
						pending: pending.size,
						entries,
						completions,
						bytesBeforeHealth: bytes,
						disposal,
					},
					true,
				);
			}, true);
		},
	};
}

/** Measure installed runner calls without replacing their test selection. */
export function timeMutationRunner(runner) {
	const path = process.env.WALLPAPERDB_MUTATION_NATIVE_EVIDENCE;
	const evidence = path ? nativeEvidence(path, runner) : undefined;
	for (const [method, phase] of [
		["dryRun", "coverageCollectionSeconds"],
		["mutantRun", "mutationExecutionSeconds"],
	]) {
		const run = runner[method].bind(runner);
		runner[method] = async (...args) => {
			const file = process.env.WALLPAPERDB_MUTATION_TIMINGS;
			const start = performance.now();
			const id = `${process.pid}:${phase}:${start}`;
			if (file) appendFileSync(file, `${JSON.stringify({ id, phase })}\n`);
			evidence?.entry(id, method, args);
			let result,
				failure,
				threw = false;
			try {
				result = await run(...args);
				return result;
			} catch (error) {
				threw = true;
				failure = error;
				throw error;
			} finally {
				if (file)
					appendFileSync(
						file,
						`${JSON.stringify({ id, phase, seconds: (performance.now() - start) / 1000 })}\n`,
					);
				evidence?.end(id, method, result, threw, failure);
			}
		};
	}
	if (evidence && typeof runner.dispose === "function") {
		const dispose = runner.dispose.bind(runner);
		runner.dispose = (...args) => {
			let result;
			try {
				result = dispose(...args);
			} catch (error) {
				evidence.finish("dispose-threw");
				throw error;
			}
			try {
				if (result && typeof result.then === "function") {
					result.then(
						() => evidence.finish("returned"),
						() => evidence.finish("dispose-threw"),
					);
				} else evidence.finish("returned");
			} catch {
				evidence.finish("dispose-observation-failed");
			}
			return result;
		};
	}
	return runner;
}

/** Interrupted calls leave a start record; completed timings remain a lower bound. */
export function readMutationTimings(file) {
	const timings = {
		coverageCollectionSeconds: 0,
		mutationExecutionSeconds: 0,
		runnerTimingsComplete: true,
	};
	const pending = new Set();
	if (existsSync(file)) {
		for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
			let record;
			try {
				record = JSON.parse(line);
			} catch {
				// A killed runner can leave an incomplete append; preserve known time.
				timings.runnerTimingsComplete = false;
				continue;
			}
			if (record.seconds === undefined) pending.add(record.id);
			else {
				pending.delete(record.id);
				timings[record.phase] += record.seconds;
			}
		}
	}
	timings.runnerTimingsComplete &&= pending.size === 0;
	return timings;
}
