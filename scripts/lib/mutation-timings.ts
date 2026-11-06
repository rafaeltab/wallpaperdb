import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** Measure installed runner calls without replacing their test selection. */
type Runner = ReturnType<
	typeof import("@stryker-mutator/vitest-runner").strykerPlugins[number]["factory"]
>;
export function timeMutationRunner(runner: Runner) {
	function timed<Args extends unknown[], Result>(
		run: (...args: Args) => Promise<Result>,
		phase: string,
	) {
		return async (...args: Args): Promise<Result> => {
			const file = process.env.WALLPAPERDB_MUTATION_TIMINGS;
			const start = performance.now();
			const id = `${process.pid}:${phase}:${start}`;
			if (file) appendFileSync(file, `${JSON.stringify({ id, phase })}\n`);
			try {
				return await run.apply(runner, args);
			} finally {
				if (file)
					appendFileSync(
						file,
						`${JSON.stringify({ id, phase, seconds: (performance.now() - start) / 1000 })}\n`,
					);
			}
		};
	}
	runner.dryRun = timed(runner.dryRun, "coverageCollectionSeconds");
	runner.mutantRun = timed(runner.mutantRun, "mutationExecutionSeconds");
	return runner;
}

/** Interrupted calls leave a start record; completed timings remain a lower bound. */
export function readMutationTimings(file: string) {
	const timings = {
		coverageCollectionSeconds: 0,
		mutationExecutionSeconds: 0,
		runnerTimingsComplete: true,
	};
	const pending = new Set();
	if (existsSync(file)) {
		for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
			let record: {
				id: string;
				phase: "coverageCollectionSeconds" | "mutationExecutionSeconds";
				seconds?: number;
			};
			try {
				record = JSON.parse(line);
			} catch {
				// A killed runner can leave an incomplete append; preserve known time.
				timings.runnerTimingsComplete = false;
				continue;
			}
			if (record.seconds === undefined) pending.add(record.id);
			else {
				pending.delete(record.id);
				timings[
					record.phase as
						| "coverageCollectionSeconds"
						| "mutationExecutionSeconds"
				] += record.seconds;
			}
		}
	}
	timings.runnerTimingsComplete &&= pending.size === 0;
	return timings;
}
