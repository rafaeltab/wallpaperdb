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
} from "./mutation-state.ts";

const isRecord = (value: unknown) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const isStageId = (value: unknown) =>
	typeof value === "string" &&
	/^(?:apps|packages)\/[a-z0-9-]+:(?:unit|integration)$/.test(value);
const isDigest = (value: unknown) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function atomicJson(file: string, value: unknown) {
	mkdirSync(join(file, ".."), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify(value, null, 2));
	renameSync(temp, file);
}
export function atomicCopy(source: string, destination: string) {
	mkdirSync(join(destination, ".."), { recursive: true });
	const temp = `${destination}.${randomUUID()}.tmp`;
	copyFileSync(source, temp);
	renameSync(temp, destination);
}
export function checkpointDirectory(root: string) {
	return join(
		git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
		"mutation",
		"repository-v1",
	);
}
export function validateCheckpoint(state: {
	version: any;
	commit?: string;
	createdAt?: string;
	scheduling: any;
	stages: any;
}) {
	if (
		state?.version !== 1 ||
		!isRecord(state.stages) ||
		!isRecord(state.scheduling)
	)
		throw new Error("Invalid repository checkpoint");
	const { cursor, attempts } = state.scheduling;
	if ((cursor !== null && !isStageId(cursor)) || !isRecord(attempts))
		throw new Error("Invalid checkpoint scheduling");
	for (const [id, attempt] of Object.entries(
		attempts as Record<string, { inputDigest: string; noProgress: number }>,
	)) {
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
		validateBaseline(stage as import("./mutation-types.ts").Baseline);
	}
}
export function importCheckpoint(
	root: string,
	jobs: {
		id: string;
		workspace: string;
		suite: string;
		config: unknown;
		sourceFiles: string[];
		mutate: string[];
		context: {
			root: any;
			workspace: any;
			suite: any;
			config: any;
			compatibility: {
				runtime: {
					node: string;
					versions: NodeJS.ProcessVersions;
					platform: NodeJS.Platform;
					arch: NodeJS.Architecture;
					os: { [k: string]: string };
					libc: any;
				};
				diagnostics: { kernelRelease: string };
				tools: any[][];
				configDigest: string;
				externalInputsDigest: string;
				environmentDigest: string;
			};
			key: string;
			inputDigest: string;
			watchRoots: any[];
			cacheDirectory: string;
		};
		scope: string;
	}[],
	file: string,
) {
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
					JSON.stringify(
						job.context.compatibility?.[
							field as keyof typeof job.context.compatibility
						],
					),
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

export function restoreScheduling(root: string) {
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
	root: string,
	jobs: {
		id: string;
		workspace: string;
		suite: string;
		config: unknown;
		sourceFiles: string[];
		mutate: string[];
		context: {
			root: any;
			workspace: any;
			suite: any;
			config: any;
			compatibility: {
				runtime: {
					node: string;
					versions: NodeJS.ProcessVersions;
					platform: NodeJS.Platform;
					arch: NodeJS.Architecture;
					os: { [k: string]: string };
					libc: any;
				};
				diagnostics: { kernelRelease: string };
				tools: any[][];
				configDigest: string;
				externalInputsDigest: string;
				environmentDigest: string;
			};
			key: string;
			inputDigest: string;
			watchRoots: any[];
			cacheDirectory: string;
		};
		scope: string;
	}[],
	scheduling: { cursor: string | null; attempts: Record<string, any> },
	destination: string,
	readBaseline: (
		context: ReturnType<typeof import("./mutation-state.ts").mutationContext>,
	) => any = restoreBaseline,
) {
	const stages: Record<string, import("./mutation-types.ts").Baseline> = {};
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
