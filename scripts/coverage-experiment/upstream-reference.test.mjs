import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { record } from "./record.mjs";
const require = createRequire(import.meta.url),
	yaml = createRequire(require.resolve("vitest"))("yaml");
const root =
	process.env.EXPERIMENT_UPSTREAM_ROOT ||
	"/tmp/wallpaperdb-742/resume/upstream";
const files = [
	"if",
	"expressions",
	"for",
	"for-in",
	"for-of",
	"while",
	"do-while",
	"yield",
	"switch",
	"functions",
	"arrow-fn",
	"try",
	"truthy",
];
const rows = [];
for (const file of files) {
	let docs;
	try {
		docs = yaml
			.parseAllDocuments(
				await readFile(`${root}/test/istanbul-references/${file}.yaml`, "utf8"),
			)
			.map((d) => d.toJSON());
	} catch (error) {
		rows.push({ file, unsupported: error.message });
		continue;
	}
	for (const suite of docs)
		for (const test of suite.tests) {
			const outputs = [];
			for (const variant of ["original-converter", "converter"]) {
				globalThis.args = structuredClone(test.args);
				globalThis.output = undefined;
				try {
					const e = await record(
						`reference-${rows.length}`,
						suite.code,
						() => globalThis.output,
						variant,
					);
					const data = Object.values(e.result)[0];
					const fields = {};
					for (const [expected, actual] of [
						["statements", data.s],
						["functions", data.f],
						["branches", data.b],
					])
						if (test[expected]) {
							try {
								assert.deepEqual(actual, test[expected]);
								fields[expected] = true;
							} catch {
								fields[expected] = false;
							}
						}
					if (test.out !== undefined) {
						try {
							assert.deepEqual(e.output, test.out);
							fields.output = true;
						} catch {
							fields.output = false;
						}
					}
					outputs.push({ variant, fields, data });
				} catch (error) {
					outputs.push({ variant, error: error.message });
				} finally {
					delete globalThis.args;
					delete globalThis.output;
				}
			}
			const introduced = [];
			if (!outputs[0].error && outputs[1].error) introduced.push("execution");
			if (!outputs[0].error && !outputs[1].error) {
				for (const key of Object.keys(outputs[0].fields))
					if (outputs[0].fields[key] && !outputs[1].fields[key])
						introduced.push(key);
				for (const key of ["statementMap", "fnMap", "branchMap"])
					assert.deepEqual(
						outputs[1].data[key],
						outputs[0].data[key],
						file + " locations",
					);
			}
			rows.push({
				file,
				name: suite.name,
				test: test.name,
				outputs,
				introduced,
			});
		}
}
await writeFile(
	"/tmp/wallpaperdb-742/adoption/upstream-reference.json",
	JSON.stringify(rows, null, 2),
);
const summary = {
	files,
	cases: rows.filter((r) => r.outputs).length,
	executed: rows.filter((r) => r.outputs?.every((o) => !o.error)).length,
	unsupported: rows
		.filter((r) => r.unsupported || r.outputs?.some((o) => o.error))
		.map((r) => ({
			file: r.file,
			name: r.name,
			error: r.unsupported || r.outputs.find((o) => o.error).error,
		})),
	stockMismatch: rows.filter(
		(r) =>
			r.outputs?.[0].fields &&
			Object.values(r.outputs[0].fields).includes(false),
	).length,
	introduced: rows
		.filter((r) => r.introduced?.length)
		.map((r) => ({ file: r.file, name: r.name, fields: r.introduced })),
};
console.log(JSON.stringify(summary, null, 2));
assert.deepEqual(summary.introduced, []);
