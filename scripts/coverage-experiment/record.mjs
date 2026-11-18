import { Session } from "node:inspector/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { parse } = await import(
	pathToFileURL(createRequire(require.resolve("vitest")).resolve("acorn"))
);
let serial = 0;
export async function record(
	name,
	code,
	exercise,
	variant = "original-converter",
) {
	await mkdir("/tmp/wallpaperdb-742/resume/programs", { recursive: true });
	const path = `/tmp/wallpaperdb-742/resume/programs/${name}-${serial++}.mjs`,
		url = pathToFileURL(path).href;
	await writeFile(path, code);
	const session = new Session();
	session.connect();
	try {
		await session.post("Profiler.enable");
		await session.post("Profiler.startPreciseCoverage", {
			callCount: true,
			detailed: true,
		});
		const module = await import(url);
		const output = await exercise(module);
		const raw = await session.post("Profiler.takePreciseCoverage");
		const coverage = raw.result.find((script) => script.url === url);
		const { default: convert } = await import(
			pathToFileURL(resolve(`.coverage-experiment/${variant}.mjs`))
		);
		const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
		const inputAst = structuredClone(ast);
		const result = await convert({ code, coverage, ast });
		const evidence = { code, ast: inputAst, coverage, result, output };
		await writeFile(
			`/tmp/wallpaperdb-742/resume/${name}-${variant}.json`,
			JSON.stringify(evidence, null, 2),
		);
		return evidence;
	} finally {
		await session.post("Profiler.stopPreciseCoverage");
		session.disconnect();
	}
}
