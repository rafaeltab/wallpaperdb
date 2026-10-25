import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	git,
	isMutationSource,
	isMutationToolInput,
	mutationContext,
} from "./mutation-state.mjs";

export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export function workspaceDirectories(root) {
	return [
		".",
		"scripts",
		"infra",
		...["apps", "packages", "experiments"].flatMap((parent) =>
			existsSync(join(root, parent))
				? readdirSync(join(root, parent)).map((name) => `${parent}/${name}`)
				: [],
		),
	].filter((directory) => existsSync(join(root, directory, "package.json")));
}
export function trackedFiles(root) {
	return [
		...new Set(
			execFileSync(
				"git",
				["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
				{ cwd: root, encoding: "utf8" },
			)
				.split("\0")
				.filter((file) => file && existsSync(join(root, file))),
		),
	].sort();
}
export function catalog(root, { package: selected, scope, base }) {
	const files = trackedFiles(root);
	const inventory = json(join(root, "mutation.inventory.json"));
	const directories = workspaceDirectories(root);
	for (const directory of directories) {
		const entry = inventory.workspaces[directory];
		if (!entry)
			throw new Error(`Mutation support decision missing: ${directory}`);
		const configured = existsSync(
			join(root, directory, "mutation.config.json"),
		);
		if (
			!["enabled", "excluded"].includes(entry.decision) ||
			(entry.decision === "enabled") !== configured
		)
			throw new Error(
				`Mutation inventory/configuration disagree: ${directory}`,
			);
		if (entry.decision === "excluded" && (!entry.reason || !entry.followUp))
			throw new Error(
				`Mutation exclusion needs a reason and follow-up: ${directory}`,
			);
	}
	for (const directory of Object.keys(inventory.workspaces))
		if (!directories.includes(directory))
			throw new Error(`Stale mutation inventory entry: ${directory}`);
	let changed = [];
	if (scope === "changed") {
		const ancestor = git(root, "merge-base", base, "HEAD");
		changed = [
			...new Set(
				[
					...execFileSync("git", ["diff", "--name-only", "-z", ancestor], {
						cwd: root,
						encoding: "utf8",
					}).split("\0"),
					...execFileSync(
						"git",
						["ls-files", "--others", "--exclude-standard", "-z"],
						{ cwd: root, encoding: "utf8" },
					).split("\0"),
				].filter(Boolean),
			),
		];
	}
	const jobs = [];
	for (const directory of directories) {
		if (selected && directory.split("/").at(-1) !== selected) continue;
		const path = join(root, directory, "mutation.config.json");
		if (!existsSync(path)) continue;
		const config = json(path);
		const stages = Object.keys(config.suites ?? {}).sort();
		if (
			!stages.length ||
			stages.some((stage) => !["unit", "integration"].includes(stage)) ||
			JSON.stringify(stages) !==
				JSON.stringify([...inventory.workspaces[directory].stages].sort())
		)
			throw new Error(
				`Mutation stage inventory/configuration disagree: ${directory}`,
			);
		for (const [suite, settings] of Object.entries(config.suites)) {
			if (
				settings.fixture &&
				![
					"redis-owned-reuse",
					"postgres-owned",
					"nats-owned",
					"s3-owned",
				].includes(settings.fixture)
			)
				throw new Error(`Unsupported mutation fixture: ${settings.fixture}`);
			const sourceFiles = files
				.filter((file) => file.startsWith(`${directory}/`))
				.map((file) => file.slice(directory.length + 1))
				.filter(
					(file) =>
						isMutationSource(file) &&
						(!settings.sourceRoots ||
							settings.sourceRoots.some((prefix) => file.startsWith(prefix))),
				);
			const context = mutationContext(root, directory, suite, {
				...settings,
				sourceFiles,
			});
			const wide =
				scope === "all" ||
				changed.some(
					(file) =>
						isMutationToolInput(file) ||
						file === "mutation.inventory.json" ||
						context.watchRoots.some(
							(dir) =>
								(file === dir || file.startsWith(`${dir}/`)) &&
								(dir !== directory ||
									!sourceFiles.includes(file.slice(directory.length + 1))),
						),
				);
			const mutate = wide
				? sourceFiles
				: sourceFiles.filter((file) =>
						changed.includes(`${directory}/${file}`),
					);
			jobs.push({
				id: `${directory}:${suite}`,
				workspace: directory,
				suite,
				config: context.config,
				sourceFiles,
				mutate,
				context,
				scope: wide ? "all" : "changed",
			});
		}
	}
	if (selected && !jobs.length)
		throw new Error(
			`No enabled mutation suites for ${selected}; see mutation.inventory.json`,
		);
	return { jobs, inventory };
}
