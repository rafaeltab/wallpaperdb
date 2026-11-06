import { randomUUID } from "node:crypto";
import { estimate, workerState } from "./boat.mjs";

const stopped = (status) => ["archived", "stopped"].includes(status);
const stopping = (status) => ["archiving", "stopping"].includes(status);

// dataExpiredAt records completed deletion, not a future retention deadline.
// https://docs.boat.dev/api-reference/sandboxes/get-sandbox
export function snapshotExpired(worker, now = Date.now()) {
	const at = worker.dataExpiredAt;
	return (
		stopped(workerState(worker)) &&
		worker.snapshotAvailable === false &&
		typeof at === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
			at,
		) &&
		Number.isFinite(Date.parse(at)) &&
		Date.parse(at) <= now
	);
}

// Snapshot contents and readiness disagree about Compose reconstruction:
// https://docs.boat.dev/snapshots/whats-saved.md#docker
// https://docs.boat.dev/readiness.md
// Neither guarantees removal of historical container/project intent. Until that
// contract exists, this module deliberately cannot issue a clean qualification.
export function snapshotLifecycle({ load, persist }) {
	function dirty() {
		const state = load();
		delete state.cleanReceipt;
		state.snapshotRecovery = {
			status: "DIRTY",
			workerId: state.id,
			reason: "authoritative-container-inventory-contract-unqualified",
		};
		persist(state);
		return state;
	}
	return {
		inspectIdentity({ info, error }) {
			const state = load();
			const worker = info?.sandbox ?? info;
			const reason =
				error?.code === "not_found"
					? "not_found"
					: worker?.id === state.id && snapshotExpired(worker)
						? "expired"
						: null;
			if (!reason) return state;
			const now = Date.now();
			state.retiredWorkers = [
				...(state.retiredWorkers ?? []),
				{
					id: state.id,
					size: state.size,
					cost: state.cost ?? 0,
					runningSince: state.runningSince,
					snapshotRecovery: state.snapshotRecovery,
					reason,
					observedAt: new Date(now).toISOString(),
					dataExpiredAt: worker?.dataExpiredAt,
				},
			];
			if (state.runningSince)
				state.cost =
					(state.cost ?? 0) +
					estimate(state.size, Math.max(0, now - state.runningSince));
			state.runningSince = null;
			const previousWorkerId = state.id;
			delete state.id;
			delete state.watcher;
			delete state.cleanReceipt;
			state.snapshotRecovery = {
				status: "RECONSTRUCTING",
				previousWorkerId,
				reason,
			};
			persist(state);
			return state;
		},
		startup(info) {
			const state = load();
			const status = info && workerState(info);
			if (
				state.snapshotRecovery?.status === "DIRTY" ||
				stopped(status) ||
				stopping(status)
			) {
				dirty();
				throw new Error(
					`DIRTY snapshot for ${state.id}: authoritative final container inventory and exclusion of historical Compose replay are unqualified; no resume or startup permitted.`,
				);
			}
			// Invalidate before effects, including failed startup. ACTIVE records use,
			// never permission to resume a stopped snapshot. Preserve desired work.
			delete state.cleanReceipt;
			state.snapshotRecovery = { status: "ACTIVE", workerId: state.id };
			persist(state);
			return state;
		},
		async stopCompute({ inspect, retire, cleanup, request, wait, budget }) {
			const state = dirty();
			const workerId = state.id;
			let attempt =
				state.shutdownAttempt?.workerId === workerId
					? state.shutdownAttempt
					: null;
			if (!attempt)
				attempt = {
					id: randomUUID(),
					workerId,
					status: "not-submitted",
					startedAt: new Date().toISOString(),
					errors: [],
				};
			attempt.lastInvocationId = budget.id;
			const errors = [];
			const persistAttempt = () => {
				const current = load();
				current.shutdownAttempt = attempt;
				persist(current);
			};
			const failure = (error) => {
				errors.push(error.message);
				attempt.errors = [...(attempt.errors ?? []), error.message].slice(-20);
				persistAttempt();
			};
			const inspectWorker = async (phase) => {
				attempt.phase = phase;
				persistAttempt();
				const info = await inspect({ shutdown: budget.phase(phase) });
				const worker = info?.sandbox ?? info;
				if (worker?.id !== undefined && worker.id !== workerId) {
					const error = new Error(
						"Shutdown inspection returned contradictory worker identity",
					);
					error.code = "wrong_worker";
					throw error;
				}
				return { info, worker, status: workerState(info) };
			};
			const complete = (observation, cleanupSkipped) => {
				// First durable replacement records proof. Accounting is a subsequent
				// replacement, never inferred from transport timeout or a missing timestamp.
				attempt.status = "completed-observed";
				attempt.completion ??= {
					workerId,
					status: observation.status,
					observedAt: new Date().toISOString(),
					provider: {
						id: observation.worker?.id,
						state: observation.worker?.state,
						status: observation.worker?.status,
						stop: observation.worker?.stop,
					},
				};
				persistAttempt();
				const current = load();
				if (!attempt.accountingAppliedAt) {
					if (current.runningSince)
						current.cost =
							(current.cost ?? 0) +
							estimate(
								current.size,
								Math.max(
									0,
									Date.parse(attempt.completion.observedAt) -
										current.runningSince,
								),
							);
					current.runningSince = null;
					delete current.watcher;
					attempt.accountingAppliedAt = new Date().toISOString();
					current.shutdownAttempt = attempt;
					persist(current);
				}
				return {
					error: errors.join("; "),
					cleanupSkipped,
					completion: attempt.completion,
				};
			};
			persistAttempt();
			let initial;
			try {
				initial = await inspectWorker("initial");
			} catch (error) {
				failure(error);
				if (error.code === "wrong_worker") throw error;
			}
			if (stopped(initial?.status)) return complete(initial, true);
			const earlierSubmission = attempt.status !== "not-submitted";
			const cleanupSkipped = stopping(initial?.status) || earlierSubmission;
			if (!cleanupSkipped) {
				for (const [phase, hook] of [
					["retirement", retire],
					["cleanup", cleanup],
				]) {
					if (!hook) continue;
					attempt.phase = phase;
					persistAttempt();
					try {
						await hook({ shutdown: budget.phase(phase) });
					} catch (error) {
						failure(error);
					}
				}
				// Durable before invoking the side effect. A later invocation observes,
				// including after a crash between this write and local request spawning.
				attempt.status = "submission-uncertain";
				attempt.phase = "submission";
				attempt.submittedAt = new Date().toISOString();
				persistAttempt();
				try {
					await request({ shutdown: budget.phase("submission") });
				} catch (error) {
					failure(error);
				}
			} else if (
				stopping(initial?.status) &&
				attempt.status !== "completed-observed"
			) {
				attempt.status = "stopping-observed";
				persistAttempt();
			}
			try {
				while (budget.remaining("observation") > 0) {
					const observation = await inspectWorker("observation");
					if (stopped(observation.status))
						return complete(observation, cleanupSkipped);
					if (!stopping(observation.status))
						throw new Error(
							`Unexpected worker state during stop: ${typeof observation.status === "string" && /^[a-z_]{1,40}$/.test(observation.status) ? observation.status : "unrecognized"}`,
						);
					if (attempt.status !== "completed-observed")
						attempt.status = "stopping-observed";
					else
						attempt.laterObservation = {
							status: observation.status,
							observedAt: new Date().toISOString(),
						};
					persistAttempt();
					await wait(Math.min(1000, budget.remaining("observation")));
				}
				throw new Error(
					"Shutdown observation: deadline exceeded; worker completion unresolved",
				);
			} catch (error) {
				failure(error);
				throw new Error(errors.join("; "));
			}
		},
	};
}
