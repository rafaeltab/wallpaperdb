import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { command } from "./lib/agent-command.mjs";
const repository = fileURLToPath(new URL("../", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function sourceSnapshot() {
	const head = command("git", ["rev-parse", "HEAD"]).trim();
	const tree = command("git", ["rev-parse", "HEAD^{tree}"]).trim();
	const hash = createHash("sha256").update(
		command("git", ["diff", "--binary", "HEAD", "--"]),
	);
	for (const filename of command("git", [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	])
		.split("\0")
		.filter(Boolean)
		.sort())
		hash
			.update(filename)
			.update(fs.readFileSync(path.join(repository, filename)));
	return { head, tree, sourceDigest: hash.digest("hex") };
}
export function recordCheck(
	request,
	execute = spawnSync,
	snapshot = sourceSnapshot,
) {
	if (
		!Array.isArray(request.command) ||
		request.command[0] !== "make" ||
		request.command.some((arg) => typeof arg !== "string")
	)
		throw new Error("Check command must be a Make argv array");
	if (!["success", "failure"].includes(request.expect))
		throw new Error("Expected success or failure");
	const output = path.resolve(request.output);
	if (!path.relative(repository, output).startsWith(`..${path.sep}`))
		throw new Error("Keep check evidence outside the repository");
	const before = snapshot();
	const startedAt = new Date().toISOString();
	const result = execute("make", request.command.slice(1), {
		cwd: repository,
		encoding: "utf8",
		timeout: request.timeoutMs ?? 3_600_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const after = snapshot();
	const log = String(result.stdout ?? "") + String(result.stderr ?? "");
	const logFile = `${output}.${randomUUID()}.log`;
	fs.writeFileSync(logFile, log, { mode: 0o600 });
	const stable = JSON.stringify(before) === JSON.stringify(after);
	const completed =
		Number.isInteger(result.status) && !result.error && !result.signal;
	const expectationMet =
		stable &&
		completed &&
		(request.expect === "success" ? result.status === 0 : result.status !== 0);
	const record = {
		...before,
		startedAt,
		finishedAt: new Date().toISOString(),
		expect: request.expect,
		expectationMet,
		stable,
		checks: [
			{
				command: request.command,
				exitCode: result.status,
				signal: result.signal ?? null,
				error: result.error?.message ?? null,
				artifact: { path: logFile, sha256: digest(log) },
			},
		],
	};
	fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n", {
		mode: 0o600,
	});
	return record;
}
