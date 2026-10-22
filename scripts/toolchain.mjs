import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function command(program, args) {
	const result = spawnSync(program, args, { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		throw new Error(
			`${program} ${args.join(" ")}: ${result.error?.message ?? result.stderr.trim()}. Run make install; see CONTRIBUTING.md.`,
		);
	}
	return result.stdout.trim();
}

try {
	const pnpm = command("mise", [
		"config",
		"get",
		"--file",
		"mise.toml",
		"tools.pnpm",
	]);
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	if (manifest.packageManager !== `pnpm@${pnpm}`) {
		throw new Error(`packageManager must equal pnpm@${pnpm} from mise.toml.`);
	}
	const node = command("mise", [
		"config",
		"get",
		"--file",
		"mise.toml",
		"tools.node",
	]);
	for (const app of existsSync("apps") ? readdirSync("apps") : []) {
		for (const filename of ["Dockerfile", "Dockerfile.dev"]) {
			const path = `apps/${app}/${filename}`;
			if (!existsSync(path)) continue;
			const source = readFileSync(path, "utf8");
			for (const match of source.matchAll(/^FROM node:([^\s]+)/gm)) {
				if (match[1] !== `${node}-alpine`)
					throw new Error(
						`${path} must use Node ${node}-alpine from mise.toml.`,
					);
			}
		}
	}
	if (!process.argv.includes("--pins")) {
		const tools = JSON.parse(command("mise", ["ls", "--current", "--json"]));
		const checks = [
			["node", "node", ["--version"]],
			["pnpm", "pnpm", ["--version"]],
			["python", "python", ["--version"]],
			["conda:git", "git", ["--version"]],
			["conda:make", "make", ["--version"]],
			["gh", "gh", ["--version"]],
			["jq", "jq", ["--version"]],
			["ripgrep", "rg", ["--version"]],
			["github:nats-io/natscli", "nats", ["--version"]],
			["docker-cli", "docker", ["--version"]],
			["github:docker/compose", "docker", ["compose", "version"]],
			["github:docker/buildx", "docker", ["buildx", "version"]],
			["agent-browser", "agent-browser", ["--version"]],
			["ffmpeg", "ffmpeg", ["-version"]],
		];
		for (const [name, program, args] of checks) {
			const selected = tools[name]?.[0];
			if (
				!selected?.installed ||
				resolve(selected.source.path) !== resolve("mise.toml")
			) {
				throw new Error(
					`${name} must be installed from this checkout's mise.toml. Run make install.`,
				);
			}
			const output = command(program, args).split("\n")[0];
			if (!output.includes(selected.version))
				throw new Error(
					`${program} selected ${output}; expected ${selected.version}. Use mise exec -- make toolchain.`,
				);
			const executable = command("sh", [
				"-c",
				'command -v "$1"',
				"sh",
				program,
			]);
			console.log(`${output}\n  ${executable}`);
		}
	}
} catch (error) {
	console.error(`Toolchain check failed: ${error.message}`);
	process.exitCode = 1;
}
