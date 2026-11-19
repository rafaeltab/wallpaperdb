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
for (const [name, calls, condition, expected] of [
	["left", [true], "value === 'left' || value === 'right'", [1, 0]],
	["right", [false], "value === 'right' || value === 'left'", [1, 0]],
	["split", [true, false], "value === 'right'", [1, 1]],
	["false", [true], "value === 'missing'", [0, 1]],
	["zero", [], "value === 'right'", [0, 0]],
] as const)
	test(`awaited conditional ${name} keeps exact alternatives and untouched zero`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "converter-"));
		const code = `export async function example(reuse) {\n const value = reuse ? await Promise.resolve('left') : await Promise.resolve('right');\n if (${condition}) { await Promise.resolve(); }\n}\nexport function untouched() { return 'never'; }\n`;
		const path = join(directory, "source.mjs");
		try {
			await writeFile(path, code);
			// Collect in ordinary Node, so Vitest's module runner cannot transform the
			// source whose exact alternative counts this control qualifies.
			execFileSync(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`
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
 for(const flag of ${JSON.stringify(calls)}) await module.example(flag);
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
			const result = reportSchema.parse(
				JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
			);
			const file = result[path];
			const id = Object.keys(file.branchMap).find(
				(id) => file.branchMap[id].type === "if",
			);
			expect(id).toBeDefined();
			if (!id) throw new Error("Missing measured branch");
			expect(file.b[id]).toStrictEqual(expected);
			expect(Object.values(file.f)).toStrictEqual([calls.length, 0]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
