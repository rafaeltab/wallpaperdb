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
		async stopCompute({ inspect, retire, cleanup, request, wait }) {
			// A bypassed cleanup, failed hook or forced provider stop cannot leave
			// behind an old receipt. Record the obligation before any remote work.
			dirty();
			const errors = [];
			let initial;
			try {
				initial = workerState(await inspect());
			} catch (error) {
				errors.push(error.message);
			}
			if (!stopped(initial) && !stopping(initial)) {
				try {
					await retire();
				} catch (error) {
					errors.push(error.message);
				}
				try {
					await cleanup?.();
				} catch (error) {
					errors.push(error.message);
				}
				// Retirement or cleanup failure must not strand compute. Never escalate to force
				// or retry an ambiguous request; observe within the existing bound.
				try {
					await request();
				} catch (error) {
					errors.push(error.message);
				}
			}
			for (let attempt = 0; attempt < 180; attempt++) {
				const status = workerState(await inspect());
				if (stopped(status)) return { error: errors.join("; ") };
				if (!stopping(status))
					throw new Error(`Unexpected worker state during stop: ${status}`);
				await wait(1000);
			}
			throw new Error(
				"Provider stop did not complete within 180 seconds; worker state must be inspected",
			);
		},
	};
}
