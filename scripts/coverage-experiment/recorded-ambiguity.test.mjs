import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { record } from "./record.mjs";
const expected = {
	"constant-false": [
		{ entry: 1, branch: [0, 1] },
		{ entry: 0, branch: [0, 0] },
	],
	"first-only": [
		{ entry: 1, branch: [0, 1] },
		{ entry: 0, branch: [0, 0] },
	],
	split: [
		{ entry: 2, branch: [1, 1] },
		{ entry: 1, branch: [1, 0] },
	],
	and: [
		{ entry: 2, branch: [1, 1], logical: [2, 1] },
		{ entry: 1, branch: [1, 0], logical: [1, 1] },
	],
};
if (process.argv[2] === "--record") {
	const [, , , kind, scenario] = process.argv;
	const source = JSON.parse(
		await readFile(
			`/tmp/wallpaperdb-742/resume/diff-${kind}-true-false-converter.json`,
			"utf8",
		),
	).code;
	const result = await record(
		"ambiguity-" + kind,
		source,
		async (m) => {
			const originalResolve = Promise.resolve,
				original = (value) => originalResolve.call(Promise, value),
				statuses = [];
			Promise.resolve = function (value) {
				if (scenario === "ambiguous" && value === "left")
					return Promise.reject("stopped");
				if (scenario === "ambiguous" && kind === "and" && value === "right")
					return original("left");
				return original(value);
			};
			try {
				for (const flag of ["and", "split"].includes(kind)
					? [true, false]
					: [true])
					statuses.push(
						await m.example(flag).then(
							() => "completed",
							(error) => {
								assert.equal(error, "stopped");
								return "rejected";
							},
						),
					);
			} finally {
				Promise.resolve = originalResolve;
			}
			return statuses;
		},
		"converter",
	);
	process.stdout.write(
		JSON.stringify({
			input: {
				code: result.code,
				ast: result.ast,
				coverage: {
					url: result.coverage.url,
					functions: result.coverage.functions,
				},
			},
			result: result.result,
			output: result.output,
		}),
	);
} else
	for (const kind of Object.keys(expected)) {
		const pair = ["original", "ambiguous"].map((s) =>
			JSON.parse(
				execFileSync(
					process.execPath,
					[fileURLToPath(import.meta.url), "--record", kind, s],
					{ encoding: "utf8" },
				),
			),
		);
		assert.deepEqual(
			pair[0].input,
			pair[1].input,
			kind + " relevant public conversion input must be identical",
		);
		assert.deepEqual(pair[0].result, pair[1].result);
		assert.deepEqual(
			pair[0].output,
			["and", "split"].includes(kind)
				? ["completed", "completed"]
				: ["completed"],
		);
		assert.deepEqual(
			pair[1].output,
			["and", "split"].includes(kind)
				? ["rejected", "completed"]
				: ["rejected"],
		);
		assert.notDeepEqual(expected[kind][0], expected[kind][1]);
		await writeFile(
			`/tmp/wallpaperdb-742/followup/ambiguity-${kind}.json`,
			JSON.stringify({ kind, expected: expected[kind], pair }, null, 2),
		);
		console.log(
			kind,
			"identical relevant raw input; distinct required coverage",
			expected[kind],
		);
	}
