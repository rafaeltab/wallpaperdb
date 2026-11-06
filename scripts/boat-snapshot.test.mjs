import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotLifecycle } from "./lib/boat-snapshot.mjs";

function fixture() {
	let state = {
		id: "owned-worker",
		cost: 1.25,
		runningSince: 123,
		developmentWanted: true,
		shutdownAttempt: {
			workerId: "owned-worker",
			accountingAppliedAt: "retained",
		},
		snapshotRecovery: { status: "DIRTY" },
		resumeAttempt: { workerId: "owned-worker", status: "submitted" },
		watcher: { pid: 42 },
		cleanReceipt: { historical: true },
	};
	return {
		read: () => structuredClone(state),
		lifecycle: snapshotLifecycle({
			load: () => structuredClone(state),
			persist: (value) => {
				state = structuredClone(value);
			},
		}),
	};
}

test("owned resume retains settled charges and requires development reconciliation", () => {
	const f = fixture();
	const previous = f.read();
	f.lifecycle.resumed({ sandbox: { id: "owned-worker", state: "ready" } });
	const state = f.read();
	assert.equal(state.cost, 1.25);
	assert.equal(state.runningSince, 123);
	assert.equal(state.developmentWanted, true);
	assert.equal(state.reconciliationPending, true);
	assert.deepEqual(state.shutdownHistory, [previous.shutdownAttempt]);
	assert.equal(state.shutdownAttempt, undefined);
	assert.equal(state.watcher, undefined);
	assert.equal(state.cleanReceipt, undefined);
	assert.deepEqual(state.snapshotRecovery, {
		status: "ACTIVE",
		workerId: "owned-worker",
	});
	assert.equal(state.resumeAttempt.status, "ready");
});

for (const worker of [
	{ id: "foreign-worker", state: "ready" },
	{ id: "owned-worker", state: "stopped" },
]) {
	test(`resume refuses ${worker.id}/${worker.state} without changing authority`, () => {
		const f = fixture();
		const previous = f.read();
		assert.throws(
			() => f.lifecycle.resumed({ sandbox: worker }),
			/owned running worker/,
		);
		assert.deepEqual(f.read(), previous);
	});
}
