import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
function snapshot(directory, outputs) {
	const result = new Map();
	function collect(relative) {
		const filename = path.join(directory, relative);
		if (!fs.existsSync(filename)) return;
		if (fs.statSync(filename).isDirectory())
			for (const entry of fs.readdirSync(filename).sort())
				collect(path.join(relative, entry));
		else result.set(relative, fs.readFileSync(filename).toString("base64"));
	}
	for (const output of outputs) collect(output);
	return JSON.stringify([...result].sort(([a], [b]) => a.localeCompare(b)));
}
export function checkGenerated(workspace, outputs, generate) {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "generated-check-"));
	const directory = path.join(temporary, "workspace");
	try {
		fs.cpSync(workspace, directory, {
			recursive: true,
			filter: (file) =>
				!/(?:^|\/)(?:node_modules|dist|coverage|\.turbo|\.git|\.env(?:\.[^/]*)?)(?:\/|$)/.test(
					file,
				),
		});
		const modules = path.join(workspace, "node_modules");
		if (fs.existsSync(modules))
			fs.symlinkSync(modules, path.join(directory, "node_modules"), "dir");
		const before = snapshot(directory, outputs);
		generate(directory);
		const first = snapshot(directory, outputs);
		generate(directory);
		const second = snapshot(directory, outputs);
		const errors = [];
		if (before !== first)
			errors.push(
				`${workspace}: stale generated artifacts in ${outputs.join(", ")}`,
			);
		if (first !== second)
			errors.push(`${workspace}: generator is not deterministic`);
		return errors;
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [kind, selected] = process.argv.slice(2);
	const definitions = JSON.parse(
		fs.readFileSync(path.join(repository, "generated.config.json"), "utf8"),
	);
	if (!definitions[kind])
		throw new Error(
			"Expected routes, openapi or migrations, optionally followed by a workspace basename",
		);
	const entries = Object.entries(definitions[kind]).filter(
		([directory]) => !selected || path.basename(directory) === selected,
	);
	if (!entries.length) throw new Error(`No ${kind} generator for ${selected}`);
	const errors = [];
	for (const [directory, { script, outputs }] of entries)
		errors.push(
			...checkGenerated(
				path.join(repository, directory),
				outputs,
				(temporary) => {
					execFileSync("pnpm", ["run", script], {
						cwd: temporary,
						stdio: ["ignore", "pipe", "pipe"],
						timeout: 60_000,
						env: {
							...process.env,
							DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
						},
					});
				},
			),
		);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else
		console.log(
			`${kind}: generators and artifacts agree for ${entries.length} workspace(s).`,
		);
}
