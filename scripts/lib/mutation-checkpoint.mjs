import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	git,
	importBaseline,
	restoreBaseline,
	validateBaseline,
} from "./mutation-state.mjs";

const isRecord = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const isStageId = (value) =>
	typeof value === "string" &&
	/^(?:apps|packages)\/[a-z0-9-]+:(?:unit|integration)$/.test(value);
const isDigest = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function atomicJson(file, value) {
	mkdirSync(join(file, ".."), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify(value, null, 2));
	renameSync(temp, file);
}
export function atomicCopy(source, destination) {
	mkdirSync(join(destination, ".."), { recursive: true });
	const temp = `${destination}.${randomUUID()}.tmp`;
	copyFileSync(source, temp);
	renameSync(temp, destination);
}
export function checkpointDirectory(root) {
	return join(
		git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
		"mutation",
		"repository-v1",
	);
}
export function validateCheckpoint(state) {
	if (
		state?.version !== 1 ||
		!isRecord(state.stages) ||
		!isRecord(state.scheduling)
	)
		throw new Error("Invalid repository checkpoint");
	const { cursor, attempts } = state.scheduling;
	if ((cursor !== null && !isStageId(cursor)) || !isRecord(attempts))
		throw new Error("Invalid checkpoint scheduling");
	for (const [id, attempt] of Object.entries(attempts)) {
		if (
			!isStageId(id) ||
			!isRecord(attempt) ||
			!isDigest(attempt.inputDigest) ||
			!Number.isSafeInteger(attempt.noProgress) ||
			attempt.noProgress < 0
		)
			throw new Error(`Invalid checkpoint scheduling attempt: ${id}`);
	}
	for (const [id, stage] of Object.entries(state.stages)) {
		if (!isStageId(id)) throw new Error(`Invalid checkpoint stage: ${id}`);
		validateBaseline(stage);
	}
}
export function importCheckpoint(root, jobs, file) {
	const state = JSON.parse(readFileSync(file, "utf8"));
	validateCheckpoint(state);
	let importedStages = 0;
	const incompatibleStages = [];
	for (const job of jobs) {
		const stage = state.stages[job.id];
		if (!stage) continue;
		if (stage.key !== job.context.key) {
			const fields = [
				"runtime",
				"tools",
				"configDigest",
				"externalInputsDigest",
				"environmentDigest",
			];
			const reasons = fields.filter(
				(field) =>
					JSON.stringify(stage.compatibility?.[field]) !==
					JSON.stringify(job.context.compatibility?.[field]),
			);
			incompatibleStages.push({ stage: job.id, reasons });
			continue;
		}
		// importBaseline validates portable paths again and publishes atomically.
		const temp = join(checkpointDirectory(root), `${randomUUID()}.stage.tmp`);
		mkdirSync(checkpointDirectory(root), { recursive: true });
		writeFileSync(temp, JSON.stringify(stage));
		try {
			importBaseline(job.context, temp);
			importedStages++;
		} finally {
			rmSync(temp);
		}
	}
	if (incompatibleStages.length)
		console.warn(
			`Incompatible checkpoint stages: ${JSON.stringify(incompatibleStages)}`,
		);
	return { ...state, importedStages, incompatibleStages };
}

export function restoreScheduling(root) {
	const directory = checkpointDirectory(root);
	if (!existsSync(directory)) return { cursor: null, attempts: {} };
	for (const name of readdirSync(directory)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.reverse()) {
		try {
			const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
			validateCheckpoint(state);
			return state.scheduling;
		} catch {
			/* A failed publication never replaces an older valid snapshot. */
		}
	}
	return { cursor: null, attempts: {} };
}

export function publishCheckpoint(
	root,
	jobs,
	scheduling,
	destination,
	readBaseline = restoreBaseline,
) {
	const stages = {};
	for (const job of jobs) {
		const stage = readBaseline(job.context);
		if (!stage) continue;
		stages[job.id] = { ...stage, report: { ...stage.report } };
		delete stages[job.id].report.projectRoot;
	}
	const state = {
		version: 1,
		commit: git(root, "rev-parse", "HEAD"),
		createdAt: new Date().toISOString(),
		scheduling,
		stages,
	};
	validateCheckpoint(state);
	const file = join(
		checkpointDirectory(root),
		`${Date.now()}-${randomUUID()}.json`,
	);
	atomicJson(file, state);
	atomicCopy(file, destination);
	return state;
}
