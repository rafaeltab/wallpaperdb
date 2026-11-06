import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../../", import.meta.url));
export function command(
	program: string,
	args: readonly string[],
	options: Omit<ExecFileSyncOptions, "encoding"> = {},
): string {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: "utf8",
		timeout: 60_000,
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
}
export function github<T>(args: readonly string[]): T {
	const value = JSON.parse(command("gh", args));
	if (value.errors?.length)
		throw new Error(`GitHub GraphQL error: ${JSON.stringify(value.errors)}`);
	return value;
}
