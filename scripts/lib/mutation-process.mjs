import { spawn } from "node:child_process";

/** Stop gracefully for Stryker's partial report, then reap its worker group. */
export function runBounded(
	command,
	args,
	{ budgetMs, graceMs = 15_000, failureSignal, ...options },
) {
	if (!Number.isFinite(budgetMs) || budgetMs <= 0)
		throw new Error("A positive budget is required");
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...options,
			detached: process.platform !== "win32",
		});
		let outcome, grace;
		const signal = (name, group = false) => {
			try {
				if (group && process.platform !== "win32")
					process.kill(-child.pid, name);
				else child.kill(name);
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		};
		const stop = (reason) => {
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
