import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { coverageEnvironment } from "./coverage-env.mjs";
import convert from "../../.coverage-experiment/converter.mjs";
const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve("vitest"))("acorn");
const dir = await mkdtemp(join(tmpdir(), "coverage-clean-env-"));
const source = join(dir, "program.mjs");
const code =
	"export function executed(){return 'hit'}\nexport function zero(){return 'miss'}\nconsole.log(executed());\n";
await writeFile(source, code);
const bare = { PATH: process.env.PATH };
const environment = coverageEnvironment(bare, {
	NODE_V8_COVERAGE: dir,
	SECRET: "must-not-propagate",
	NODE_OPTIONS: "must-not-propagate",
});
assert.equal(environment.SECRET, undefined);
assert.equal(environment.NODE_OPTIONS, undefined);
const child = spawnSync(process.execPath, [source], {
	encoding: "utf8",
	env: environment,
});
assert.equal(child.status, 0, child.stderr);
assert.equal(child.stdout, "hit\n");
const files = (await readdir(dir)).filter(
	(f) => f.startsWith("coverage-") && f.endsWith(".json"),
);
assert.equal(
	files.length,
	1,
	"clean environment child must reach official V8 collection",
);
const raw = JSON.parse(await readFile(join(dir, files[0]), "utf8")).result.find(
	(s) => s.url === pathToFileURL(source).href,
);
const c = Object.values(
	await convert({
		code,
		ast: parse(code, { ecmaVersion: "latest", sourceType: "module" }),
		coverage: raw,
	}),
)[0];
assert.deepEqual(Object.values(c.s), [1, 0, 1]);
assert.deepEqual(Object.values(c.f), [1, 0]);
console.log(
	"Clean-environment child exact statements [1,0,1], functions [1,0]",
);
