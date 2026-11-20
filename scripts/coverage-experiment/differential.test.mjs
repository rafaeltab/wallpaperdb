import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { record } from "./record.mjs";
const rows = [];
const cases = [
	{ name: "constant-true", condition: "true", calls: [true], expected: [1, 0] },
	{
		name: "constant-false",
		condition: "false",
		calls: [true],
		expected: [0, 1],
	},
	{
		name: "left-short",
		condition: "value === 'left' || value === 'right'",
		calls: [true, false],
		expected: [2, 0],
		logical: [2, 1],
	},
	{
		name: "right-short",
		condition: "value === 'right' || value === 'left'",
		calls: [true, false],
		expected: [2, 0],
		logical: [2, 1],
	},
	{
		name: "and",
		condition: "value === 'left' && value !== 'right'",
		calls: [true, false],
		expected: [1, 1],
		logical: [2, 1],
	},
	{
		name: "split",
		condition: "value === 'right'",
		calls: [true, false],
		expected: [1, 1],
	},
	{
		name: "first-only",
		condition: "value === 'right'",
		calls: [true],
		expected: [0, 1],
	},
	{
		name: "second-only",
		condition: "value === 'right'",
		calls: [false],
		expected: [1, 0],
	},
];
for (const c of cases)
	for (const compact of [false, true])
		for (const alternate of [false, true]) {
			const code = `export async function example(reuse) {\n const value = ${compact ? "reuse?await Promise.resolve('left'):await Promise.resolve('right')" : "reuse ? await Promise.resolve('left') : await Promise.resolve('right')"};\n if (${c.condition}) { await Promise.resolve(); }${alternate ? " else { await Promise.resolve(); }" : ""}\n}\n`;
			const outputs = [];
			for (const variant of ["original-converter", "converter"]) {
				const e = await record(
					`diff-${c.name}-${compact}-${alternate}`,
					code,
					async (m) => {
						for (const flag of c.calls) await m.example(flag);
					},
					variant,
				);
				const f = Object.values(e.result)[0],
					branches = Object.fromEntries(
						Object.entries(f.branchMap).map(([id, b]) => [b.type, f.b[id]]),
					);
				const actual = {
					if: branches.if,
					statement: Object.entries(f.statementMap)
						.filter(([, loc]) => loc.start.line === 3 && loc.start.column === 1)
						.map(([id]) => f.s[id])[0],
					functions: Object.values(f.f),
					logical: branches["binary-expr"],
				};
				const expected = {
					if: c.expected,
					statement: c.calls.length,
					functions: [c.calls.length],
					logical: c.logical,
				};
				let correct = true;
				try {
					assert.deepEqual(actual, expected);
				} catch {
					correct = false;
				}
				outputs.push({ variant, actual, correct });
			}
			const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
			const expected = {
				if: c.expected,
				statement: c.calls.length,
				functions: [c.calls.length],
				logical: c.logical,
			};
			const regressions = Object.keys(expected).filter(
				(k) =>
					same(outputs[0].actual[k], expected[k]) &&
					!same(outputs[1].actual[k], expected[k]),
			);
			for (const field of ["if", "functions", "logical"])
				if (Array.isArray(expected[field]))
					for (let i = 0; i < expected[field].length; i++)
						if (
							outputs[0].actual[field]?.[i] === expected[field][i] &&
							outputs[1].actual[field]?.[i] !== expected[field][i]
						)
							regressions.push(field + "[" + i + "]");
			rows.push({
				name: c.name,
				compact,
				alternate,
				outputs,
				expected,
				regressions,
				introduced: regressions.length > 0,
			});
		}
for (const context of [
	"direct",
	"callback",
	"loop",
	"nested",
	"straight-line",
	"throwing-initializer",
])
	for (const compact of [false, true])
		for (const arm of [true, false])
			for (const state of ["resolved", "rejected", "pending"])
				for (const alternate of [false, true]) {
					const condition = "value === 'right' || value === 'left'";
					const init = compact
						? "reuse?await promise:await promise"
						: "reuse ? await promise : await promise";
					const between =
						context === "straight-line"
							? "const receipt={}; receipt.value=value; const deferred=()=>receipt.value;\n"
							: context === "throwing-initializer"
								? "const check=(()=>{throw new Error('stopped');})();\n"
								: "";
					const core = `const value=${init};\n${between}if (${condition}) { await Promise.resolve(); }${alternate ? " else { await Promise.resolve(); }" : ""}\n`;
					const body =
						context === "callback"
							? `const invoke=async()=>{${core}}; await invoke();`
							: context === "loop"
								? `for(let i=0;i<2;i++){${core}}`
								: context === "nested"
									? `if(reuse!==undefined){${core}}`
									: core;
					const code = `export async function example(reuse,promise){\n${body}\n}`;
					const line = code
						.slice(0, code.indexOf("if (value"))
						.split("\n").length;
					const count =
						context === "throwing-initializer" || state !== "resolved"
							? 0
							: context === "loop"
								? 2
								: 1;
					const expected = {
						if: [count, 0],
						statement: count,
						logical: [count, arm ? count : 0],
						functions:
							context === "callback"
								? [1, 1]
								: context === "straight-line"
									? [1, 0]
									: context === "throwing-initializer"
										? [1, state === "resolved" ? 1 : 0]
										: [1],
					};
					const outputs = [];
					const maps = [];
					for (const variant of ["original-converter", "converter"]) {
						const e = await record(
							`context-${context}-${compact}-${arm}-${state}-${alternate}`,
							code,
							async (m) => {
								const promise =
									state === "pending"
										? new Promise(() => {})
										: state === "rejected"
											? Promise.reject(new Error("expected"))
											: Promise.resolve(arm ? "left" : "right");
								const result = m.example(arm, promise);
								if (state === "pending") {
									result.catch(() => {});
								} else await result.catch(() => {});
							},
							variant,
						);
						const f = Object.values(e.result)[0];
						const branch = Object.entries(f.branchMap).find(
							([, b]) => b.type === "if" && b.loc.start.line === line,
						);
						const logical = Object.entries(f.branchMap).find(
							([, b]) => b.type === "binary-expr" && b.loc.start.line === line,
						);
						const stmt = Object.entries(f.statementMap).find(
							([, loc]) =>
								loc.start.line === line &&
								loc.start.column === branch?.[1].loc.start.column,
						);
						const actual = {
							if: f.b[branch?.[0]],
							statement: f.s[stmt?.[0]],
							logical: f.b[logical?.[0]],
							functions: Object.values(f.f),
						};
						maps.push({
							statementMap: f.statementMap,
							branchMap: f.branchMap,
							fnMap: f.fnMap,
						});
						outputs.push({
							variant,
							actual,
							correct: JSON.stringify(actual) === JSON.stringify(expected),
						});
					}
					assert.deepEqual(maps[1], maps[0], "locations changed");
					const regressions = [];
					for (const field of Object.keys(expected))
						for (const i of Array.isArray(expected[field])
							? [0, 1]
							: [undefined]) {
							const get = (x) => (i === undefined ? x[field] : x[field]?.[i]);
							if (
								get(outputs[0].actual) === get(expected) &&
								get(outputs[1].actual) !== get(expected)
							)
								regressions.push(field + String(i ?? ""));
							if (
								typeof get(outputs[1].actual) === "number" &&
								get(outputs[1].actual) < 0 &&
								get(outputs[0].actual) >= 0
							)
								regressions.push("new negative " + field);
						}
					rows.push({
						name: context,
						compact,
						arm,
						state,
						alternate,
						expected,
						outputs,
						regressions,
						introduced: regressions.length > 0,
					});
				}
for (const row of rows)
	if (row.expected) {
		for (const [field, expected] of Object.entries(row.expected)) {
			const values = Array.isArray(expected) ? expected : [expected];
			for (let i = 0; i < values.length; i++)
				if (typeof values[i] === "number") {
					const before = Array.isArray(expected)
						? row.outputs[0].actual[field]?.[i]
						: row.outputs[0].actual[field];
					const after = Array.isArray(expected)
						? row.outputs[1].actual[field]?.[i]
						: row.outputs[1].actual[field];
					if (Math.abs(after - values[i]) > Math.abs(before - values[i])) {
						row.regressions.push("worsened " + field);
						row.introduced = true;
					}
				}
		}
	}
await writeFile(
	"/tmp/wallpaperdb-742/adoption/differential.json",
	JSON.stringify(rows, null, 2),
);
console.log(
	JSON.stringify(
		rows.filter((r) => r.introduced),
		null,
		2,
	),
);
assert.equal(
	rows.filter((r) => r.introduced).length,
	0,
	"stock-correct cases became wrong",
);

// Semantic acceptance for every retained case, except the four exact layouts
// whose public input collisions are independently proved by recorded-ambiguity.
const remaining = rows.filter((row) => !row.outputs[1].correct);
assert.deepEqual(
	remaining.map((row) => [row.name, row.compact, row.alternate]).sort(),
	[
		["and", true, false],
		["constant-false", true, false],
		["first-only", true, false],
		["split", true, false],
	].sort(),
	"unexplained source-level coverage failures",
);
console.log(
	"Retained semantic controls: 172 correct; 4 exact raw-ambiguity witnesses, literal expectations preserved",
);
