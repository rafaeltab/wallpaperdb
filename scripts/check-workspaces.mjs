import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function hasTypeScript(directory) {
	if (!fs.existsSync(directory)) return false;
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.some((e) =>
			e.isDirectory()
				? !["node_modules", "dist", ".turbo"].includes(e.name) &&
					hasTypeScript(path.join(directory, e.name))
				: /\.[cm]?tsx?$/.test(e.name),
		);
}
export function checkWorkspaces(root) {
	const errors = [];
	const patterns = [
		...fs
			.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")
			.matchAll(/^  - ['"]?([^'"\s]+)['"]?\s*$/gm),
	].map((m) => m[1]);
	const directories = [];
	for (const pattern of patterns) {
		if (pattern.endsWith("/*")) {
			const parent = pattern.slice(0, -2);
			if (fs.existsSync(path.join(root, parent)))
				for (const e of fs.readdirSync(path.join(root, parent), {
					withFileTypes: true,
				}))
					if (e.isDirectory()) directories.push(`${parent}/${e.name}`);
		} else if (!/[*!?{}]/.test(pattern)) directories.push(pattern);
		else
			errors.push(
				`Unsupported workspace pattern ${pattern}; extend workspace discovery`,
			);
	}
	const manifests = new Map();
	for (const directory of directories) {
		const file = path.join(root, directory, "package.json");
		if (!fs.existsSync(file)) {
			if (hasTypeScript(path.join(root, directory)))
				errors.push(
					`${directory}: maintained code requires an owning package.json`,
				);
			continue;
		}
		const manifest = read(file);
		if (manifests.has(manifest.name))
			errors.push(`Duplicate workspace name ${manifest.name}`);
		manifests.set(manifest.name, { directory, manifest });
	}
	const tasks = read(path.join(root, "turbo.json")).tasks;
	for (const [name, { directory, manifest }] of manifests) {
		const scripts = manifest.scripts ?? {};
		if (hasTypeScript(path.join(root, directory, "src")))
			for (const task of ["lint", "check-types"])
				if (!scripts[task])
					errors.push(`${directory}: TypeScript source requires ${task}`);
		for (const task of [
			"build",
			"lint",
			"check-types",
			"test:unit",
			"test:integration",
			"test:e2e",
		])
			if (scripts[task] && !tasks[task] && !tasks[`${name}#${task}`])
				errors.push(
					`${directory}: ${task} is absent from the Turbo task graph`,
				);
		if (directory.startsWith("packages/"))
			for (const dependency of Object.keys({
				...manifest.dependencies,
				...manifest.devDependencies,
				...manifest.peerDependencies,
				...manifest.optionalDependencies,
			}))
				if (manifests.get(dependency)?.directory.startsWith("apps/"))
					errors.push(`${name} must not depend on application ${dependency}`);
	}
	return errors;
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const errors = checkWorkspaces(repository);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else
		console.log(
			"Workspace ownership, applicable tasks and package dependency direction verified.",
		);
}
