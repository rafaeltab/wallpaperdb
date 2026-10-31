// Disposable C benchmark: compile frozen common source, never implementation-child outputs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const base = "dc17dead07c1d1f66e1806412cb7623812601bf1";
if (
	spawnSync("git", ["cat-file", "-e", `${base}^{tree}`], {
		cwd: root,
		stdio: "ignore",
	}).status !== 0
)
	execFileSync("git", ["fetch", "--depth=1", "origin", base], {
		cwd: root,
		stdio: "inherit",
	});
const frozen = spawnSync(
	"git",
	[
		"diff",
		"--quiet",
		"dc17dead07c1d1f66e1806412cb7623812601bf1",
		"--",
		"packages/core",
	],
	{ cwd: root },
);
if (frozen.status !== 0)
	throw new Error("Cache proof requires unchanged frozen common source");
const directory = path.join(root, ".boat/common-cache-proof");
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });
const archive = execFileSync(
	"git",
	["archive", "dc17dead07c1d1f66e1806412cb7623812601bf1", "packages/core/src"],
	{ maxBuffer: 16 * 1024 * 1024 },
);
execFileSync("tar", ["-x", "-C", directory], { input: archive });
fs.renameSync(
	path.join(directory, "packages/core/src"),
	path.join(directory, "src"),
);
fs.rmSync(path.join(directory, "packages"), { recursive: true });
fs.copyFileSync("pnpm-lock.yaml", path.join(directory, "pnpm-lock.yaml"));
fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages: []\n");
const link = path.join(directory, "node_modules");
if (!fs.existsSync(link))
	fs.symlinkSync(path.join(root, "packages/core/node_modules"), link);
fs.writeFileSync(
	path.join(directory, "package.json"),
	JSON.stringify({
		name: "boat-frozen-common-proof",
		private: true,
		type: "module",
		packageManager: "pnpm@10.18.3",
		scripts: { build: "node build.mjs" },
	}),
);
fs.writeFileSync(
	path.join(directory, "build.mjs"),
	`import { build } from '../../scripts/node_modules/esbuild/lib/main.js';
await build({entryPoints:['src/assets/index.ts','src/quarantine/index.ts','src/errors/index.ts','src/health/index.ts','src/openapi/index.ts','src/connections/database.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outdir:'dist',metafile:true}).then(x=>import('node:fs').then(fs=>fs.writeFileSync('dist/meta.json',JSON.stringify(x.metafile))));
`,
);
fs.writeFileSync(
	path.join(directory, "turbo.json"),
	JSON.stringify({
		futureFlags: { experimentalObservability: true },
		tasks: { build: { outputs: ["dist/**"] } },
	}),
);
// Every invocation removes worker-local cache and outputs. Gateway GET is required.
fs.rmSync(path.join(directory, ".turbo"), { recursive: true, force: true });
fs.rmSync(path.join(directory, "dist"), { recursive: true, force: true });
const start = Date.now();
const result = spawnSync(
	path.join(root, "node_modules/.bin/turbo"),
	["run", "build", "--cache=remote:rw", "--summarize"],
	{ cwd: directory, stdio: "inherit", env: process.env },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const summaryFile = fs
	.readdirSync(path.join(directory, ".turbo/runs"))
	.find((name) => name.endsWith(".json"));
const summary = JSON.parse(
	fs.readFileSync(path.join(directory, ".turbo/runs", summaryFile), "utf8"),
);
const outputs = [];
function inventory(dir) {
	for (const name of fs.readdirSync(dir)) {
		const file = path.join(dir, name);
		if (fs.statSync(file).isDirectory()) inventory(file);
		else {
			const bytes = fs.readFileSync(file);
			outputs.push({
				file: path.relative(directory, file),
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
	}
}
inventory(path.join(directory, "dist"));
const proof = {
	at: new Date().toISOString(),
	ms: Date.now() - start,
	tasks: summary.tasks.map(({ hash, cache }) => ({ hash, cache })),
	outputs,
};
fs.writeFileSync(
	path.join(root, ".boat/common-cache-proof.json"),
	JSON.stringify(proof, null, 2),
);
console.log(JSON.stringify(proof));
