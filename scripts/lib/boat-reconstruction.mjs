import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { liveOwnedProcess, workerState } from "./boat.mjs";
import { snapshotExpired } from "./boat-snapshot.mjs";
import { shutdownBudget } from "./boat-shutdown.mjs";

const active = (worker) =>
	["ready", "running", "idle"].includes(workerState(worker));
const stopped = (worker) =>
	["stopped", "archived"].includes(workerState(worker));

export function completedStop(worker, id) {
	const stop = worker?.stop;
	return (
		worker?.id === id &&
		stopped(worker) &&
		typeof stop?.id === "string" &&
		stop.status === "completed" &&
		stop.forced === false &&
		stop.error === null &&
		Number.isFinite(Date.parse(stop.endedAt))
	);
}

// Caller holds lifecycle and source ownership. Intent and candidate publication
// use durable persistence. CLI create has no idempotency key: absence from list,
// including an exact-name lookup, never authorizes repeating an uncertain create.
export async function freshWorker({
	root,
	config,
	load,
	persist,
	json,
	admit,
	snapshots,
	preflight,
}) {
	let state = load();
	let observedStop;
	const pending = state.admission && state.admission.status !== "published";
	if (pending) {
		assertAdmission(state, config);
		const admission = state.admission;
		// A cleanup decision is durable. Active metadata cannot cancel a submitted
		// stop, or turn a previously completed candidate into admitted work.
		if (admission.shutdownAttempt) {
			if (admission.candidate) {
				const info = await json(["info", admission.candidate.id]);
				const worker = info?.sandbox ?? info;
				if (
					worker?.id === admission.candidate.id &&
					worker.name === admission.name &&
					worker.type === admission.size &&
					active(worker) &&
					!admission.runningSince
				) {
					// Reactivation time is unknown. Charge conservatively from the completed
					// observation and retain already settled charges and the original attempt.
					admission.runningSince = Date.parse(
						admission.shutdownAttempt.completion.observedAt,
					);
					admission.stopContradiction = {
						workerId: worker.id,
						status: workerState(worker),
						observedAt: new Date().toISOString(),
					};
					persist(state);
				}
			}
			throw new Error(
				"Candidate stop obligation retained; no publication, bootstrap or new work admitted",
			);
		}
	}
	if (!pending && state.id) {
		let info, error;
		try {
			info = await json(["info", state.id]);
		} catch (failure) {
			if (failure.code !== "not_found") throw failure;
			error = failure;
		}
		state = snapshots.inspectIdentity({ info, error });
		if (state.id) {
			const worker = info?.sandbox ?? info;
			if (worker?.id !== state.id)
				throw new Error(
					"Fresh lifecycle inspection returned wrong worker identity",
				);
			if (active(worker)) return snapshots.startup(info);
			if (!completedStop(worker, state.id))
				throw new Error(
					"Fresh admission requires an observed completed nonforced stop for the exact old worker; no create",
				);
			observedStop = {
				workerId: state.id,
				status: workerState(worker),
				observedAt: new Date().toISOString(),
				provider: {
					id: worker.id,
					state: worker.state,
					status: worker.status,
					stop: worker.stop,
				},
			};
			// Reuse the existing completion/accounting transition. This does not
			// qualify snapshot contents or require successful application cleanup.
			await snapshots.stopCompute({
				inspect: async () => info,
				budget: shutdownBudget(config.shutdownBudgetMs),
			});
			state = load();
		}
	}
	// Never discard source uncertainty or acknowledge publication using a new
	// identity. Recovery still sees the old worker while source.lock is held.
	preflight();
	for (const name of fs.readdirSync(path.join(root, ".boat"))) {
		if (!/^command-\d+\.json$/.test(name)) continue;
		const lease = JSON.parse(fs.readFileSync(path.join(root, ".boat", name)));
		if (liveOwnedProcess(root, lease))
			throw new Error(
				"Fresh admission blocked by active command owner; no create",
			);
	}
	if (fs.existsSync(path.join(root, ".boat/asset-migration-active.json")))
		throw new Error(
			"Fresh admission blocked by unresolved Asset migration ownership",
		);
	let admission = state.admission;
	if (!pending) {
		admit();
		const limits = await json(["limits"]);
		if (!limits.canStart || limits.nextStartDollars > 0)
			throw new Error(
				"Worker admission refused: starts unavailable or paid bursting required",
			);
		const token = randomUUID();
		admission = {
			owner: { root: config.root, key: config.key },
			token,
			name: `wallpaperdb-557-${config.cohort}-${config.key}-${token}`,
			previousWorkerId: state.id ?? state.snapshotRecovery?.previousWorkerId,
			size: config.size,
			status: "create-unknown",
			runningSince: Date.now(),
			stopCompletion: observedStop,
		};
		state.admission = admission;
		persist(state);
		console.log(
			"Fresh worker scratch reset: reconstruct remote DB, dependencies and Docker state; preserve local source/Git and external Turbo cache.",
		);
		let created;
		try {
			created = await json([
				"new",
				"--type",
				admission.size,
				"--ttl",
				"2100",
				"--no-env",
				"--name",
				admission.name,
			]);
		} catch {
			throw new Error(
				`Unknown create obligation ${admission.token}; no automatic retry, resume or name-only reconciliation`,
			);
		}
		const id = created.sandbox?.id ?? created.id;
		if (
			typeof id !== "string" ||
			!/^[a-zA-Z0-9_-]+$/.test(id) ||
			id === admission.previousWorkerId
		)
			throw new Error(
				`Unknown create obligation ${admission.token}: missing or contradictory candidate ID; no retry`,
			);
		admission.candidate = { id, name: admission.name, size: admission.size };
		admission.status = "candidate-owned";
		persist(state);
	}
	if (!admission.candidate)
		throw new Error(
			`Unknown admission create obligation ${admission.token}; no automatic retry even if list is empty`,
		);
	const candidate = admission.candidate;
	if (state.id) {
		const oldInfo = await json(["info", state.id]);
		if (
			!completedStop(oldInfo?.sandbox ?? oldInfo, state.id) ||
			(oldInfo?.sandbox ?? oldInfo).stop.id !==
				admission.stopCompletion?.provider?.stop?.id
		)
			throw new Error(
				"Fresh candidate blocked: old worker stop no longer completed; preserve both obligations",
			);
	}
	if (
		candidate.name !== admission.name ||
		candidate.size !== config.size ||
		admission.size !== config.size ||
		(state.id && state.id !== admission.previousWorkerId)
	)
		throw new Error(
			"Stale candidate ownership; preserve admission and inspect before cleanup",
		);
	const info = await json(["info", candidate.id]);
	const worker = info?.sandbox ?? info;
	if (
		worker?.id !== candidate.id ||
		worker.name !== admission.name ||
		worker.type !== admission.size ||
		!active(worker) ||
		snapshotExpired(worker)
	)
		throw new Error(
			"Candidate identity/readiness mismatch; preserve admission and inspect before cleanup",
		);
	const {
		retiredWorkers,
		admission: _admission,
		admissionHistory: _history,
		...previous
	} = state;
	if (state.id)
		state.retiredWorkers = [
			...(retiredWorkers ?? []),
			{
				...previous,
				reason: "fresh-after-stop",
				replacementIntent: admission.token,
			},
		];
	state.admissionHistory = [...(state.admissionHistory ?? []), admission];
	state.id = candidate.id;
	state.size = admission.size;
	state.runningSince = admission.runningSince;
	state.lastActivity = Date.now();
	state.snapshotRecovery = { status: "ACTIVE", workerId: state.id };
	for (const field of [
		"shutdownAttempt",
		"watcher",
		"developmentDependencies",
		"cleanReceipt",
	])
		delete state[field];
	if (state.developmentWanted) state.reconciliationPending = true;
	for (const name of ["prepared.json", "manifest.json", "source-modes.json"])
		fs.rmSync(path.join(root, ".boat", name), { force: true });
	admission.status = "published";
	persist(state);
	return state;
}

export function assertAdmission(state, config) {
	const a = state.admission;
	if (
		!a ||
		!["create-unknown", "candidate-owned"].includes(a.status) ||
		a.owner?.root !== config.root ||
		a.owner?.key !== config.key ||
		!/^[a-f0-9-]{36}$/.test(a.token) ||
		a.name !== `wallpaperdb-557-${config.cohort}-${config.key}-${a.token}` ||
		a.size !== config.size ||
		!Number.isFinite(
			a.runningSince ?? Date.parse(a.shutdownAttempt?.completion?.observedAt),
		) ||
		(state.id && state.id !== a.previousWorkerId) ||
		(a.candidate &&
			(a.candidate.id === a.previousWorkerId ||
				a.candidate.name !== a.name ||
				a.candidate.size !== a.size))
	)
		throw new Error(
			"Stale candidate admission ownership; preserve unknown obligation",
		);
}
