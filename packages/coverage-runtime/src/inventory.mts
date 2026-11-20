import { z } from "zod";
import { workspaceManifestSchema } from "./json.mjs";
import { resolve } from "node:path";
import { repositoryConfiguration, repositoryRoot } from "./repository-root.mjs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import yaml from "yaml";
process.chdir(repositoryRoot());
const { sourceViteWorkspaces } = await repositoryConfiguration();
const patterns = z
	.object({ packages: z.array(z.string()) })
	.parse(yaml.parse(await readFile("pnpm-workspace.yaml", "utf8"))).packages;
const directories = ["."];
for (const pattern of patterns) {
	if (pattern.endsWith("/*")) {
		const parent = pattern.slice(0, -2);
		if (!existsSync(parent)) continue;
		for (const name of await readdir(parent))
			if (existsSync(`${parent}/${name}/package.json`))
				directories.push(`${parent}/${name}`);
	} else if (existsSync(`${pattern}/package.json`)) directories.push(pattern);
}
const workspaces = [],
	tiers = [];
for (const workspace of directories) {
	const manifest = workspaceManifestSchema.parse(
		JSON.parse(await readFile(`${workspace}/package.json`, "utf8")),
	);
	if (workspace !== "." && !manifest.name)
		throw new Error("Missing workspace name");
	workspaces.push({
		directory: workspace,
		name: manifest.name || "@wallpaperdb/root",
	});
	for (const script of ["test:unit", "test:integration"]) {
		const command: unknown = manifest.scripts?.[script];
		if (command !== undefined && typeof command !== "string")
			throw new Error("Invalid test command");
		if (!command) continue;
		let part = 0;
		for (const chunk of command.split("&&").map((value) => value.trim())) {
			if (chunk === "cd ..") continue;
			const match = chunk.match(/(?:^|\/)vitest\s+(.*)$/);
			if (!match)
				throw new Error(
					`Unsupported maintained test command: ${workspace} ${script}: ${chunk}`,
				);
			const args = match[1].split(/\s+/).filter((arg) => arg !== "run");
			const config = args.includes("--config")
				? args[args.indexOf("--config") + 1]
				: "vitest.config.ts";
			const vite =
				sourceViteWorkspaces.includes(workspace) ||
				config.startsWith("frontend/");
			tiers.push({
				id: `${workspace === "." ? "root" : workspace.replaceAll("/", "-")}-${script.replace("test:", "")}-${++part}`,
				workspace,
				runtime: workspace === "scripts" ? "." : workspace,
				script,
				config,
				args: args.filter(
					(arg, index) => arg !== "--config" && args[index - 1] !== "--config",
				),
				strategy: vite ? "source-vite" : "compiled-native",
				coverage:
					args.includes("--coverage") ||
					(workspace === "apps/web" && config === "vitest.browser.config.ts"),
				containers:
					workspace !== "apps/factory" &&
					(script === "test:integration" ||
						workspace === "packages/url-ipv4-resolver"),
			});
		}
	}
}
const output =
	process.env.WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT ||
	resolve(repositoryRoot(), ".coverage-runtime/evidence");
await mkdir(output, { recursive: true });
await writeFile(
	`${output}/matrix.json`,
	JSON.stringify({ workspaces, tiers }, null, 2),
);
console.log(
	`${workspaces.length} workspaces; ${tiers.length} configured unit/integration invocations`,
);
