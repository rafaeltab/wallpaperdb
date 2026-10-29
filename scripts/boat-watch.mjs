import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const project = process.env.COMPOSE_PROJECT_NAME;
if (!project) throw new Error("Missing worktree Compose project");
const compose = [
	"compose",
	"-p",
	project,
	"-f",
	path.join(root, "infra/docker-compose.apps.yml"),
];
const config = JSON.parse(
	execFileSync("docker", [...compose, "config", "--format", "json"], {
		cwd: root,
		maxBuffer: 8 * 1024 * 1024,
	}),
);
for (const service of Object.values(config.services)) {
	for (const item of service.develop?.watch ?? []) {
		if (["sync", "sync+restart"].includes(item.action))
			item.initial_sync = true;
	}
}
const file = path.join(root, ".boat/development-compose.json");
fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
const child = spawn(
	"make",
	[
		"dev",
		"PACKAGE=",
		"BOAT_EXEC=worker",
		"ARGS=--no-up",
		`APPS_COMPOSE=docker compose -p ${project} -f ${file}`,
	],
	{ cwd: root, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
	process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on("close", (code) => {
	process.exitCode = code ?? 143;
});
