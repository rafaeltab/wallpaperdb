import { Session } from "node:inspector/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse } = await import(
	pathToFileURL(createRequire(require.resolve("vitest")).resolve("acorn"))
);
const { default: convert } = await import(
	pathToFileURL(
		resolve(
			`.coverage-experiment/${process.argv.includes("--baseline") ? "original-converter" : process.argv.includes("--rejected") ? "rejected-converter" : "converter"}.mjs`,
		),
	)
);
const failures = [];
await mkdir("/tmp/wallpaperdb-742", { recursive: true });
for (const [name, condition, calls, expected] of [
	[
		"left",
		"value === 'right' || value === 'left'",
		"await example(true);",
		[1, 0],
	],
	[
		"right",
		"value === 'right' || value === 'left'",
		"await example(false);",
		[1, 0],
	],
	[
		"both",
		"value === 'right' || value === 'left'",
		"await example(true); await example(false);",
		[2, 0],
	],
	[
		"false",
		"value === 'missing' || value === 'none'",
		"await example(true);",
		[0, 1],
	],
	["zero", "value === 'right' || value === 'left'", "", [0, 0]],
	[
		"split",
		"value === 'right'",
		"await example(true); await example(false);",
		[1, 1],
	],
]) {
	const selected = process.argv
		.find((arg) => arg.startsWith("--case="))
		?.slice(7);
	if (selected && selected !== name) continue;
	const source = `export async function example(reuse) {
 const value = reuse ? await Promise.resolve('left') : await Promise.resolve('right');
 if (${condition}) { await Promise.resolve(); }
}
export function untouched() { return 'never'; }
${calls}\n`;
	const file = resolve(`.coverage-experiment/${name}.mjs`),
		url = pathToFileURL(file).href;
	await writeFile(file, source);
	const session = new Session();
	session.connect();
	await session.post("Profiler.enable");
	await session.post("Profiler.startPreciseCoverage", {
		callCount: true,
		detailed: true,
	});
	await import(url);
	const raw = await session.post("Profiler.takePreciseCoverage");
	await session.post("Profiler.stopPreciseCoverage");
	session.disconnect();
	const coverage = raw.result.find((x) => x.url === url);
	const result = await convert({
		code: source,
		ast: parse(source, { ecmaVersion: "latest", sourceType: "module" }),
		coverage,
	});
	const data = Object.values(result)[0];
	await writeFile(
		`/tmp/wallpaperdb-742/${process.argv.includes("--baseline") ? "baseline" : process.argv.includes("--rejected") ? "rejected" : "candidate"}-${name}.json`,
		JSON.stringify({ source, coverage, result }, null, 2),
	);
	const branch = Object.keys(data.branchMap).find(
		(k) => data.branchMap[k].type === "if",
	);
	console.log(
		name,
		"if",
		data.b[branch],
		"statements",
		data.s,
		"functions",
		data.f,
	);
	try {
		assert.deepEqual(data.b[branch], expected);
		// These literal counts follow the program's calls, not the conversion algorithm.
		if (name === "left") {
			assert.deepEqual(Object.values(data.s), [1, 1, 1, 0, 1]);
			assert.deepEqual(Object.values(data.f), [1, 0]);
			assert.deepEqual(
				Object.fromEntries(
					Object.entries(data.branchMap).map(([id, b]) => [b.type, data.b[id]]),
				),
				{ "cond-expr": [1, 0], if: [1, 0], "binary-expr": [1, 1] },
			);
		}
		if (name === "split") {
			assert.deepEqual(Object.values(data.s), [2, 2, 1, 0, 1, 1]);
			assert.deepEqual(Object.values(data.f), [2, 0]);
			assert.deepEqual(
				Object.fromEntries(
					Object.entries(data.branchMap).map(([id, b]) => [b.type, data.b[id]]),
				),
				{ "cond-expr": [1, 1], if: [1, 1] },
			);
		}
		const fn = Object.keys(data.fnMap).find(
			(k) => data.fnMap[k].name === "untouched",
		);
		assert.equal(data.f[fn], 0);
		const ifStatement = Object.keys(data.statementMap).find(
			(k) =>
				data.statementMap[k].start.line === 3 &&
				data.statementMap[k].start.column === 1,
		);
		assert.equal(data.s[ifStatement], expected[0] + expected[1]);
		const body = Object.keys(data.statementMap).find(
			(k) =>
				data.statementMap[k].start.line === 3 &&
				data.statementMap[k].start.column > 1,
		);
		assert.equal(data.s[body], expected[0]);
		assert.ok(Object.values(data.s).every((n) => n >= 0));
		const logical = Object.keys(data.branchMap).find(
			(k) => data.branchMap[k].type === "binary-expr",
		);
		if (logical)
			assert.deepEqual(
				data.b[logical],
				name === "zero"
					? [0, 0]
					: name === "both"
						? [2, 1]
						: name === "right"
							? [1, 0]
							: [1, 1],
			);
	} catch (error) {
		failures.push({ name, message: error.message });
	}
}

console.log(JSON.stringify({ failures }, null, 2));
if (failures.length) process.exitCode = 1;
