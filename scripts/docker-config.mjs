import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Docker and Compose discover plugins from configuration, not the executable
// PATH. Keep a private derived config, retaining the source credentials/context.
const source = resolve(process.argv[2]);
const sourceFile = join(source, "config.json");
const config = existsSync(sourceFile)
	? JSON.parse(readFileSync(sourceFile, "utf8"))
	: {};
const plugins = ["docker-compose", "docker-buildx"].map((name) => {
	const result = spawnSync("mise", ["which", name], { encoding: "utf8" });
	if (result.status !== 0 || result.error)
		throw new Error(
			`Cannot locate managed ${name}: ${result.error?.message ?? result.stderr}`,
		);
	return [name, result.stdout.trim()];
});
const key = createHash("sha256")
	.update(JSON.stringify([source, config, plugins]))
	.digest("hex");
const directory = fileURLToPath(
	new URL(`../.mise/docker/${key}/`, import.meta.url),
);
const pluginDirectory = join(directory, "cli-plugins");
mkdirSync(pluginDirectory, { recursive: true, mode: 0o700 });
function link(target, path) {
	try {
		symlinkSync(target, path);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
}
for (const [name, path] of plugins) link(path, join(pluginDirectory, name));
// Preserve contexts, TLS material, and other Docker configuration directories.
for (const name of existsSync(source) ? readdirSync(source) : []) {
	if (name !== "config.json" && name !== "cli-plugins")
		link(join(source, name), join(directory, name));
}
config.cliPluginsExtraDirs = [
	pluginDirectory,
	...(config.cliPluginsExtraDirs ?? []),
	join(source, "cli-plugins"),
];
try {
	writeFileSync(join(directory, "config.json"), `${JSON.stringify(config)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
} catch (error) {
	if (error.code !== "EEXIST") throw error;
}
console.log(directory);
