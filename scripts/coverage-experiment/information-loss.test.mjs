import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { record } from "./record.mjs";

const programs = {
	join: `export async function example(reuse,promise,test){const value=reuse?await promise:await promise;if(test){await 1;}}`,
	generator: `export function* example(){yield 'first';}`,
};
const variants = ["original-converter", "rejected-converter", "converter"];
if (process.argv[2] === "--record") {
	const [kind, scenario, variant] = process.argv.slice(3);
	const evidence = await record(
		`identical-${kind}`,
		programs[kind],
		async (module) => {
			if (kind === "join") {
				try {
					await module.example(
						true,
						scenario === "fulfilled-false"
							? Promise.resolve("ok")
							: Promise.reject("rejected"),
						scenario !== "fulfilled-false",
					);
					return "completed";
				} catch (error) {
					assert.equal(error, "rejected");
					return "rejected";
				}
			}
			if (scenario === "uncalled") return "uncalled";
			const iterator = module.example();
			if (scenario === "created") return "created";
			const first = iterator.next();
			if (scenario === "advanced") return first;
			return [first, iterator.next()];
		},
		variant,
	);
	// This is the exact public converter input: source, AST of that source, URL,
	// and functions. The caller's argument values are not coverage measurements.
	const input = {
		code: evidence.code,
		ast: evidence.ast,
		coverage: {
			url: evidence.coverage.url,
			functions: evidence.coverage.functions,
		},
	};
	const data = Object.values(evidence.result)[0];
	process.stdout.write(
		JSON.stringify({
			input,
			result: evidence.result,
			output: evidence.output,
			s: data.s,
			f: data.f,
			b: data.b,
		}),
	);
} else {
	const kind = process.argv.includes("--generator") ? "generator" : "join";
	const scenarios =
		kind === "join"
			? ["fulfilled-false", "rejected-true"]
			: ["uncalled", "created", "advanced"];
	const results = [];
	for (const variant of variants) {
		const records = scenarios.map((scenario) =>
			JSON.parse(
				execFileSync(
					process.execPath,
					[fileURLToPath(import.meta.url), "--record", kind, scenario, variant],
					{ encoding: "utf8" },
				),
			),
		);
		if (kind === "join")
			assert.deepEqual(
				records[0].input,
				records[1].input,
				"different executions have identical public measurement input",
			);
		else {
			assert.deepEqual(
				records[1].input,
				records[2].input,
				"creating and advancing a generator have identical public measurement input",
			);
			assert.notDeepEqual(
				records[0].input,
				records[1].input,
				"uncalled control remains distinguishable",
			);
		}
		if (kind === "join") {
			assert.deepEqual(
				records.map((r) => r.output),
				["completed", "rejected"],
			);
		} else {
			assert.deepEqual(
				records.map((r) => r.output),
				["uncalled", "created", { value: "first", done: false }],
			);
		}
		if (kind === "generator") {
			const core = await import(
				new URL(
					"../../.coverage-experiment/build/packages/crap-typescript-core/src/index.js",
					import.meta.url,
				)
			);
			for (let index = 0; index < records.length; index++) {
				const record = records[index],
					path = `/tmp/wallpaperdb-742/resume/${variant}-${scenarios[index]}-istanbul.json`;
				await writeFile(path, JSON.stringify(record.result));
				const parsed = await core.parseCoverageReport(path, process.cwd());
				const source = fileURLToPath(record.input.coverage.url),
					methods = await core.parseFileMethods(source);
				const coverage = core.coverageForMethods(methods, parsed.get(source));
				record.crap = {
					methods,
					coverage,
					score: core.calculateCrapScore(
						methods[0].complexity,
						coverage[0].statementCoverage.percent,
					),
					expectedStatementPercent: index === 2 ? 100 : 0,
				};
			}
		}
		const expected =
			kind === "join"
				? {
						statements: [
							[1, 1, 0],
							[1, 0, 0],
						],
						ifBranches: [
							[0, 1],
							[0, 0],
						],
					}
				: { statements: [[0], [0], [1]], functionInvocations: [[0], [1], [1]] };
		// These semantic literals document what the identical measurements would
		// need to distinguish. Assertions above check the actual recordings and
		// observable execution results; red coverage assertions live in the other tests.
		results.push({ variant, kind, scenarios, expected, records });
	}
	await writeFile(
		`/tmp/wallpaperdb-742/resume/${kind}-information-loss.json`,
		JSON.stringify(results, null, 2),
	);
	console.log(
		`${kind}: exact public measurement inputs identical for an execution pair, for all ${variants.length} converter variants`,
	);
	for (const r of results)
		console.log(
			r.variant,
			r.records.map((x) => ({
				output: x.output,
				s: x.s,
				f: x.f,
				b: x.b,
				crap: x.crap?.score,
			})),
		);
}
