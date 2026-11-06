import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../../", import.meta.url));
export function command(program, args, options = {}) {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: "utf8",
		timeout: 60_000,
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
}
export function github(args) {
	const value = JSON.parse(command("gh", args));
	if (value.errors?.length)
		throw new Error(`GitHub GraphQL error: ${JSON.stringify(value.errors)}`);
	return value;
}
