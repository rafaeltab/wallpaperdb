import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeRun, DEFAULT_OUTPUT_ROOT } from "./runner.mjs";
import { renderMarkdown, renderHtml } from "./report.mjs";

const [command, ...args] = process.argv.slice(2);
function option(name) {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	if (!args[index + 1] || args[index + 1].startsWith("--"))
		throw Error(`${name} requires a value`);
	return args[index + 1];
}
async function json(filename) {
	return JSON.parse(await readFile(filename, "utf8"));
}
try {
	if (command === "run") {
		const configPath = path.resolve(
			option("--config") ??
				new URL("configs/initial.json", import.meta.url).pathname,
		);
		const config = await json(configPath);
		const outputRoot = path.resolve(
			option("--output") ?? config.outputRoot ?? DEFAULT_OUTPUT_ROOT,
		);
		let previous;
		const explicitPrevious = option("--previous") ?? config.compareWith;
		if (explicitPrevious) previous = await json(path.resolve(explicitPrevious));
		else
			try {
				previous = await json(
					(await json(path.join(outputRoot, "latest.json"))).run,
				);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		const { run, directory } = await executeRun({
			config,
			configDirectory: path.dirname(configPath),
			outputRoot,
			previous,
			onProgress: (message) => console.log(message),
		});
		console.log(`Report: ${path.join(directory, "report.html")}`);
		for (const c of run.candidates)
			console.log(
				`${c.id}: ${c.summary.coverage.ok}/${c.summary.coverage.total} cases evaluated; ${c.summary.coverage.unsupported} unsupported; ${c.summary.coverage.error} errors; ${c.summary.performance.sampleCount} timed searches`,
			);
		if (
			run.candidates.some(
				(c) =>
					c.summary.coverage.error ||
					c.summary.performance.failures ||
					c.cleanupError,
			)
		)
			process.exitCode = 1;
	} else if (command === "report") {
		const filename = option("--run");
		if (!filename) throw Error("--run is required");
		const run = await json(filename);
		const previous = option("--previous")
			? await json(option("--previous"))
			: undefined;
		const directory = path.dirname(path.resolve(filename));
		await writeFile(
			path.join(directory, "report.md"),
			renderMarkdown(run, previous),
		);
		await writeFile(
			path.join(directory, "report.html"),
			renderHtml(run, previous),
		);
		console.log(`Report: ${path.join(directory, "report.html")}`);
	} else
		throw Error(
			"Usage: cli.mjs run --config FILE [--output DIR] [--previous RUN.json] | report --run RUN.json [--previous RUN.json]",
		);
} catch (error) {
	console.error(error.stack ?? error);
	process.exitCode = 1;
}
