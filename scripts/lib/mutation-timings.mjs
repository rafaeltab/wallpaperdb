import {
	appendFileSync,
	closeSync,
	constants,
	existsSync,
	fstatSync,
	openSync,
	readFileSync,
	readSync,
} from "node:fs";

/** Read only the stage-owned timing file at the fixed cancellation boundary. */
export function nativeCancellationWindow(file) {
	let descriptor;
	try {
		descriptor = openSync(
			file,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	let text;
	try {
		if (!fstatSync(descriptor).isFile())
			throw new Error("Native timing receipt is not a regular file");
		const limit = 1024 * 1024;
		const buffer = Buffer.alloc(limit + 1);
		let size = 0;
		while (size < buffer.length) {
			const count = readSync(descriptor, buffer, size, buffer.length - size);
			if (!count) break;
			size += count;
		}
		if (size > limit) throw new Error("Native timing receipt exceeds limit");
		text = buffer.subarray(0, size).toString("utf8");
	} finally {
		closeSync(descriptor);
	}
	const pending = new Map();
	const seen = new Set();
	let completed;
	for (const line of text.split("\n").filter(Boolean)) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			throw new Error("Malformed native timing JSON");
		}
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			throw new Error("Malformed native timing record");
		if (entry.phase !== "mutationExecutionSeconds") continue;
		if (
			typeof entry.id !== "string" ||
			entry.id.length > 256 ||
			typeof entry.mutation !== "string" ||
			!entry.mutation ||
			entry.mutation.length > 128 ||
			!/^\d+:mutationExecutionSeconds:\d+(?:\.\d+)?$/.test(entry.id) ||
			!/^\d+$/.test(entry.mutation) ||
			!Number.isFinite(entry.at) ||
			entry.at <= 0
		)
			throw new Error("Malformed native timing identity");
		if (entry.seconds === undefined) {
			if (seen.has(entry.id) || entry.endedAt !== undefined)
				throw new Error("Ambiguous native timing start");
			seen.add(entry.id);
			pending.set(entry.id, entry);
		} else {
			const start = pending.get(entry.id);
			if (
				!start ||
				start.mutation !== entry.mutation ||
				start.at !== entry.at ||
				!Number.isFinite(entry.seconds) ||
				entry.seconds < 0 ||
				!Number.isFinite(entry.endedAt) ||
				entry.endedAt < entry.at
			)
				throw new Error("Unmatched native timing completion");
			pending.delete(entry.id);
			completed = entry;
		}
	}
	if (!completed || !pending.size) return null;
	if (pending.size !== 1)
		throw new Error("Ambiguous active native cancellation window");
	const active = [...pending.values()][0];
	if (completed.endedAt > active.at)
		throw new Error("Overlapping native cancellation window");
	const receipt = ({ id, mutation, at, endedAt, seconds }) => ({
		id,
		mutation,
		at,
		...(endedAt === undefined ? {} : { endedAt, seconds }),
	});
	return { completed: receipt(completed), active: receipt(active) };
}

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
			const mutation = args[0]?.activeMutant?.id;
			const record = { id, phase, mutation, at: Date.now() };
			if (file) appendFileSync(file, `${JSON.stringify(record)}\n`);
			try {
				return await run(...args);
			} finally {
				if (file)
					appendFileSync(
						file,
						`${JSON.stringify({ ...record, endedAt: Date.now(), seconds: (performance.now() - start) / 1000 })}\n`,
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
