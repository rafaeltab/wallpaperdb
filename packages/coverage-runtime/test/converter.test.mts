import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { reportSchema } from "../src/json.mjs";
const require = createRequire(import.meta.url);
const candidate = pathToFileURL(require.resolve("ast-v8-to-istanbul")).href;
const acorn = pathToFileURL(require.resolve("acorn")).href;
async function measuredSource(
	code: string,
	calls: readonly (
		| boolean
		| { flag: boolean; source: Record<string, never> | null; rejects: boolean }
	)[],
	outcome: { rejects: boolean; reached: boolean } | undefined = undefined,
) {
	const directory = await mkdtemp(join(tmpdir(), "converter-"));
	const path = join(directory, "source.mjs");
	try {
		await writeFile(path, code);
		// Ordinary Node records the exact source bytes without Vitest transforms.
		execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`
import assert from 'node:assert/strict';
import {Session} from 'node:inspector/promises';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from ${JSON.stringify(acorn)};
import convert from ${JSON.stringify(candidate)};
const url=${JSON.stringify(pathToFileURL(path).href)}, session=new Session();
session.connect();
try {
 await session.post('Profiler.enable');
 await session.post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 const module=await import(url);
 for(const call of ${JSON.stringify(calls)}) {
  const args = typeof call === 'boolean' ? [call] : [call.flag,call.source];
  const rejects = typeof call === 'boolean' ? ${outcome?.rejects || false} : call.rejects;
  if (rejects) await assert.rejects(module.example(...args), Error);
  else await module.example(...args);
 }
 ${outcome ? `assert.equal(module.reached, ${outcome.reached});` : ""}
 const raw=await session.post('Profiler.takePreciseCoverage');
 const code=await readFile(new URL(url),'utf8');
 const coverage=raw.result.find(script=>script.url===url);
 if(!coverage) throw new Error('Missing measured source');
 const result=await convert({code,coverage,ast:parse(code,{ecmaVersion:'latest',sourceType:'module'})});
 await writeFile(${JSON.stringify(join(directory, "result.json"))},JSON.stringify(result));
} finally {await session.post('Profiler.stopPreciseCoverage'); session.disconnect();}
`,
			],
			{ env: { ...process.env, NODE_OPTIONS: "" } },
		);
		return reportSchema.parse(
			JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
		)[path];
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
for (const [name, calls, condition, expected] of [
	["left", [true], "value === 'left' || value === 'right'", [1, 0]],
	["right", [false], "value === 'right' || value === 'left'", [1, 0]],
	["split", [true, false], "value === 'right'", [1, 1]],
	["false", [true], "value === 'missing'", [0, 1]],
	["zero", [], "value === 'right'", [0, 0]],
] as const)
	test(`awaited conditional ${name} keeps exact alternatives and untouched zero`, async () => {
		const code = `export async function example(reuse) {\n const value = reuse ? await Promise.resolve('left') : await Promise.resolve('right');\n if (${condition}) { await Promise.resolve(); }\n}\nexport function untouched() { return 'never'; }\n`;
		const file = await measuredSource(code, calls);
		const id = Object.keys(file.branchMap).find(
			(id) => file.branchMap[id].type === "if",
		);
		expect(id).toBeDefined();
		if (!id) throw new Error("Missing measured branch");
		expect(file.b[id]).toStrictEqual(expected);
		expect(Object.values(file.f)).toStrictEqual([calls.length, 0]);
	});

for (const [name, declaration, condition, throws, expected] of [
	["array destructuring", "const [item] = null;", "value", true, [0, 0]],
	["object destructuring", "const {item} = null;", "value", true, [0, 0]],
	[
		"binding default",
		"const {item = (() => { throw new Error('binding'); })()} = {};",
		"value",
		true,
		[0, 0],
	],
	["ordinary declaration", "const item = value;", "value", false, [1, 0]],
	["valid object binding", "const {item} = {};", "item", false, [0, 1]],
	["valid binding default", "const {item = true} = {};", "item", false, [1, 0]],
	[
		"valid alias binding",
		"const object = {}; const {item = true} = object;",
		"item",
		false,
		[1, 0],
	],
	["valid string binding", "const [item] = 'x';", "item", false, [1, 0]],
	["valid rest binding", "const {...item} = {};", "item", false, [1, 0]],
	[
		"valid computed literal binding",
		"const {['item']: item = true} = {};",
		"item",
		false,
		[1, 0],
	],
	[
		"throwing computed binding",
		"const {[(() => { throw new Error('key'); })()]: item} = {};",
		"value",
		true,
		[0, 0],
	],
] as const)
	test(`awaited continuation preserves ${name} reachability`, async () => {
		const code = `export let reached = false;
export async function example(flag) {
 const value = flag ? await Promise.resolve(true) : await Promise.resolve(false);
 ${declaration}
 if (${condition}) { reached = true; await Promise.resolve(); }
}
`;
		const file = await measuredSource(code, [true], {
			rejects: throws,
			reached: expected[0] > 0,
		});

		const id = Object.keys(file.branchMap).find(
			(id) => file.branchMap[id].type === "if",
		);
		if (!id) throw new Error("Missing measured branch");
		expect(file.b[id]).toStrictEqual(expected);
		const statement = Object.entries(file.statementMap).find(
			([, loc]) => loc.start.line === 5 && loc.start.column === 1,
		);
		if (!statement) throw new Error("Missing measured if statement");
		expect(file.s[statement[0]]).toBe(throws ? 0 : 1);
	});

for (const declaration of [
	"const [item] = 'x';",
	"const object = {}; const {item = true} = object;",
])
	test(`explicit else retains measured guard execution after ${declaration}`, async () => {
		const code = `export async function example(flag) {
 const value = flag ? await Promise.resolve(true) : await Promise.resolve(false);
 ${declaration}
 if (item) { await Promise.resolve(); } else { await Promise.resolve(); }
}`;
		const file = await measuredSource(code, [true]);
		const branch = Object.keys(file.branchMap).find(
			(id) => file.branchMap[id].type === "if",
		);
		const statement = Object.entries(file.statementMap).find(
			([, loc]) => loc.start.line === 4 && loc.start.column === 1,
		);
		if (!branch || !statement) throw new Error("Missing if measurement");
		expect(file.b[branch]).toStrictEqual([1, 0]);
		expect(file.s[statement[0]]).toBe(1);
	});

test("mixed completed and throwing bindings preserve an uncovered false arm", async () => {
	const code = `export async function example(flag, source) {
 const value = flag ? await Promise.resolve(true) : await Promise.resolve(false);
 const {item = true} = source;
 if (item) { await Promise.resolve(); }
}`;
	const file = await measuredSource(code, [
		{ flag: true, source: {}, rejects: false },
		{ flag: true, source: null, rejects: true },
	]);
	const branch = Object.keys(file.branchMap).find(
		(id) => file.branchMap[id].type === "if",
	);
	const statement = Object.entries(file.statementMap).find(
		([, loc]) => loc.start.line === 4 && loc.start.column === 1,
	);
	if (!branch || !statement) throw new Error("Missing if measurement");
	expect(file.b[branch]).toStrictEqual([1, 0]);
	expect(file.s[statement[0]]).toBe(1);
});
