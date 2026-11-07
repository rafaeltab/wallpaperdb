import { spawn } from "node:child_process";

/** Stop gracefully for Stryker's partial report, then reap its worker group. */
export function runBounded(
	command: string,
	args: readonly string[],
	{
		budgetMs,
		graceMs = 15_000,
		failureSignal,
		...options
	}: import("node:child_process").SpawnOptions & {
		budgetMs: number;
		graceMs?: number;
		failureSignal?: AbortSignal;
	},
) {
	if (!Number.isFinite(budgetMs) || budgetMs <= 0)
		throw new Error("A positive budget is required");
	return new Promise<{
		outcome: string;
		code: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...options,
			detached: process.platform !== "win32",
		});
		let outcome: string | undefined,
			grace: string | number | NodeJS.Timeout | undefined;
		const signal = (
			name: NodeJS.Signals | number | undefined,
			group = false,
		) => {
			try {
				if (group && process.platform !== "win32")
					process.kill(-child.pid!, name);
				else child.kill(name);
			} catch (caught) {
				const error = caught as NodeJS.ErrnoException & { status?: number };
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		};
		const stop = (reason: string) => {
			if (outcome) return;
			outcome = reason;
			// Signal Stryker first. Its handler writes the incremental report before exiting.
			signal("SIGINT");
			grace = setTimeout(() => signal("SIGKILL", true), graceMs);
		};
		const interrupt = () => stop("cancelled");
		const fail = () => stop("failed");
		failureSignal?.addEventListener("abort", fail, { once: true });
		process.once("SIGINT", interrupt);
		process.once("SIGTERM", interrupt);
		const deadline = setTimeout(() => stop("budget-exhausted"), budgetMs);
		const cleanup = () => {
			clearTimeout(deadline);
			clearTimeout(grace);
			process.removeListener("SIGINT", interrupt);
			process.removeListener("SIGTERM", interrupt);
			failureSignal?.removeEventListener("abort", fail);
			if (child.pid) signal("SIGKILL", true);
		};
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("exit", (code, signalName) => {
			cleanup();
			resolve({
				outcome: outcome ?? (code === 0 ? "completed" : "failed"),
				code,
				signal: signalName,
			});
		});
	});
}
