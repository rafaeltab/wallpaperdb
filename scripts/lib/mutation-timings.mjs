import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** Measure installed runner calls without replacing their test selection. */
export function timeMutationRunner(runner) {
	for (const [method, phase] of [
		["dryRun", "coverageCollectionSeconds"],
		["mutantRun", "mutationExecutionSeconds"],
	]) {
		const run = runner[method].bind(runner);
		runner[method] = async (...args) => {
			const file = process.env.WALLPAPERDB_MUTATION_TIMINGS;
			const start = performance.now();
			const id = `${process.pid}:${phase}:${start}`;
			if (file) appendFileSync(file, `${JSON.stringify({ id, phase })}\n`);
			try {
				return await run(...args);
			} finally {
				if (file)
					appendFileSync(
						file,
						`${JSON.stringify({ id, phase, seconds: (performance.now() - start) / 1000 })}\n`,
					);
			}
		};
	}
	return runner;
}

/** Interrupted calls leave a start record; completed timings remain a lower bound. */
export function readMutationTimings(file) {
	const timings = {
		coverageCollectionSeconds: 0,
		mutationExecutionSeconds: 0,
		runnerTimingsComplete: true,
	};
	const pending = new Set();
	if (existsSync(file)) {
		for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
			let record;
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
				timings[record.phase] += record.seconds;
			}
		}
	}
	timings.runnerTimingsComplete &&= pending.size === 0;
	return timings;
}
