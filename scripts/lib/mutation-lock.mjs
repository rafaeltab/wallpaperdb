import { execFileSync } from "node:child_process";
import { constants, openSync, closeSync, fstatSync, lstatSync } from "node:fs";
import { defaultDockerLock } from "./docker-queue.mjs";

/** Share the same host lock as ordinary Docker-heavy local validation. */
export function acquireMutationLock(timeoutMs) {
	const waitMs = Math.max(1, Math.floor(timeoutMs));
	const file =
		process.env.DOCKER_VALIDATION_LOCK_FILE ||
		process.env.E2E_LOCK_FILE ||
		defaultDockerLock;
	const descriptor = openSync(
		file,
		constants.O_CREAT |
			constants.O_WRONLY |
			constants.O_APPEND |
			constants.O_NOFOLLOW |
			constants.O_NONBLOCK,
		0o600,
	);
	try {
		const stat = fstatSync(descriptor);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid() ||
			stat.nlink !== 1 ||
			stat.size !== 0 ||
			stat.mode & 0o022
		)
			throw new Error(`Unsafe Docker host lock target: ${file}`);
		console.log(
			`Waiting for Docker host lock, at most ${Math.ceil(waitMs / 1000)} seconds`,
		);
		execFileSync("flock", ["-E", "75", "-w", String(waitMs / 1000), "3"], {
			timeout: waitMs + 1000,
			stdio: ["ignore", "inherit", "inherit", descriptor],
		});
		const current = lstatSync(file),
			opened = fstatSync(descriptor);
		if (
			current.isSymbolicLink() ||
			current.ino !== opened.ino ||
			current.dev !== opened.dev ||
			opened.nlink !== 1
		)
			throw new Error("Docker host lock target changed during acquisition");
		return () => closeSync(descriptor);
	} catch (error) {
		closeSync(descriptor);
		throw error;
	}
}
