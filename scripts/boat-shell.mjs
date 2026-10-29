import fs from "node:fs";
import { spawn } from "node:child_process";
const env = { ...process.env };
const file = ".boat/cache.json";
if (fs.existsSync(file)) {
	const cache = JSON.parse(fs.readFileSync(file, "utf8"));
	Object.assign(env, {
		TURBO_API: cache.api,
		TURBO_TEAM: "team_boat557",
		TURBO_TOKEN: cache.token,
	});
}
const stdio = ["inherit", "inherit", "inherit"];
const descriptor = Number(env.WALLPAPERDB_DOCKER_LEASE_FD);
if (Number.isInteger(descriptor) && descriptor > 2) {
	while (stdio.length <= descriptor) stdio.push("ignore");
	stdio[descriptor] = descriptor;
}
const child = spawn("sh", process.argv.slice(2), { stdio, env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
	process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on("close", (code, signal) => {
	process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
});
