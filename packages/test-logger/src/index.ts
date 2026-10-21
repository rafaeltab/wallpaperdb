import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

export function createTestLogger(name: string) {
	return pino({
		name,
		level: process.env.LOG_LEVEL ?? "silent",
	});
}

export async function measureTestPhase<T>(
	phase: string,
	operation: () => Promise<T>,
): Promise<T> {
	if (process.env.CI_RUNTIME_PROFILE !== "true") return operation();
	const startedAt = new Date().toISOString();
	const started = performance.now();
	let status: "passed" | "failed" = "passed";
	try {
		return await operation();
	} catch (error) {
		status = "failed";
		throw error;
	} finally {
		const durationMs = performance.now() - started;
		try {
			const directory = join(process.cwd(), "test-results");
			mkdirSync(directory, { recursive: true });
			appendFileSync(
				join(directory, `ci-runtime-${process.pid}.jsonl`),
				`${JSON.stringify({
					phase,
					startedAt,
					durationMs,
					status,
					pid: process.pid,
				})}\n`,
			);
		} catch {
			// Profiling must preserve the operation's result, including its original failure.
		}
	}
}
