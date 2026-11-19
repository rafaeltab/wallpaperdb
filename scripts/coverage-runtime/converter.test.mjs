import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import convert from "ast-v8-to-istanbul";

for (const [name, calls, condition, expected] of [
	["left", [true], "value === 'left' || value === 'right'", [1, 0]],
	["right", [false], "value === 'right' || value === 'left'", [1, 0]],
	["split", [true, false], "value === 'right'", [1, 1]],
	["false", [true], "value === 'missing'", [0, 1]],
	["zero", [], "value === 'right'", [0, 0]],
])
	test(`awaited conditional ${name} keeps exact alternatives and untouched zero`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "converter-"));
		const code = `export async function example(reuse) {\n const value = reuse ? await Promise.resolve('left') : await Promise.resolve('right');\n if (${condition}) { await Promise.resolve(); }\n}\nexport function untouched() { return 'never'; }\n`;
		const path = join(directory, "source.mjs"),
			url = pathToFileURL(path).href,
			session = new Session();
		await writeFile(path, code);
		session.connect();
		try {
			await session.post("Profiler.enable");
			await session.post("Profiler.startPreciseCoverage", {
				callCount: true,
				detailed: true,
			});
			const module = await import(url);
			for (const flag of calls) await module.example(flag);
			const raw = await session.post("Profiler.takePreciseCoverage");
			const result = await convert({
				code,
				coverage: raw.result.find((script) => script.url === url),
				ast: parse(code, { ecmaVersion: "latest", sourceType: "module" }),
			});
			const file = result[path],
				id = Object.keys(file.branchMap).find(
					(id) => file.branchMap[id].type === "if",
				);
			assert.deepEqual(file.b[id], expected);
			assert.deepEqual(Object.values(file.f), [calls.length, 0]);
		} finally {
			await session.post("Profiler.stopPreciseCoverage");
			session.disconnect();
			await rm(directory, { recursive: true, force: true });
		}
	});
