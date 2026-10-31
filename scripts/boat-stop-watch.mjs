import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ownsWatch({ root, cwd, project, argv }) {
	const at = argv.indexOf("-p");
	return (
		cwd === root &&
		!!project &&
		at >= 0 &&
		argv[at + 1] === project &&
		path.basename(argv[0] ?? "") === "docker-compose" &&
		argv.includes("watch")
	);
}

if (
	process.argv[1] === "-" ||
	path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
	const root = process.cwd(),
		project =
			process.env.COMPOSE_PROJECT_NAME ||
			fs
				.readFileSync(".worktree", "utf8")
				.match(/^COMPOSE_PROJECT_NAME=(.+)$/m)?.[1];
	if (!project) throw new Error("Missing owned Compose project");
	for (const name of fs.readdirSync("/proc")) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const directory = `/proc/${name}`;
			const identity = fs
				.readFileSync(`${directory}/stat`, "utf8")
				.split(") ")[1]
				.split(" ")[19];
			const argv = fs.readFileSync(`${directory}/cmdline`, "utf8").split("\0");
			if (!ownsWatch({ root, cwd: root, project, argv })) continue;
			let cwd;
			try {
				cwd = fs.readlinkSync(`${directory}/cwd`);
			} catch (error) {
				if (error.code === "EACCES")
					throw new Error(
						"Cannot inspect an owned watcher candidate; privileged inspection is required",
					);
				throw error;
			}
			if (!ownsWatch({ root, cwd, project, argv })) continue;
			const current = fs
				.readFileSync(`${directory}/stat`, "utf8")
				.split(") ")[1]
				.split(" ")[19];
			if (current === identity) {
				process.kill(Number(name), "SIGTERM");
				const started = Date.now();
				while (true) {
					let live;
					try {
						live = fs
							.readFileSync(`${directory}/stat`, "utf8")
							.split(") ")[1]
							.split(" ")[19];
					} catch (error) {
						if (error.code === "ENOENT") break;
						throw error;
					}
					if (live !== identity) break;
					if (Date.now() - started >= 10000)
						throw new Error(
							`Owned watcher ${name} did not terminate within 10 seconds`,
						);
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				console.log(`Stopped owned Compose watcher ${name}`);
			}
		} catch (error) {
			if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
		}
	}
}
