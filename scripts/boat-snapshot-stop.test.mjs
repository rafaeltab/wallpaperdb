import assert from "node:assert/strict";
import test from "node:test";
import { snapshotLifecycle } from "./lib/boat-snapshot.mjs";

function fixture(shutdownAttempt) {
	let state = {
		id: "owned-worker",
		size: "large",
		cost: 2,
		runningSince: Date.now() - 1000,
		...(shutdownAttempt && { shutdownAttempt }),
	};
	return {
		get state() {
			return structuredClone(state);
		},
		lifecycle: snapshotLifecycle({
			load: () => structuredClone(state),
			persist: (next) => {
				state = structuredClone(next);
			},
		}),
		budget: {
			id: "owned-invocation",
			phase: (phase) => ({ phase }),
			remaining: () => 1000,
		},
	};
}

const missing = () =>
	Object.assign(new Error("not found"), { code: "not_found" });

test("acknowledged stop followed by deletion accounts once without another stop", async () => {
	const f = fixture();
	let inspections = 0;
	let submissions = 0;
	const hooks = {
		budget: f.budget,
		inspect: async () => {
			if (inspections++ === 0)
				return {
					sandbox: { id: "owned-worker", state: "ready", snapshots: false },
				};
			throw missing();
		},
		request: async () => {
			submissions++;
		},
		wait: async () => {},
	};
	const result = await f.lifecycle.stopCompute(hooks);
	assert.equal(result.error, "");
	assert.equal(result.completion.status, "deleted");
	assert.equal(result.completion.absence.code, "not_found");
	assert.equal(result.completion.provider, undefined);
	assert.equal(f.state.runningSince, null);
	assert.ok(f.state.cost > 2);
	const cost = f.state.cost;
	await f.lifecycle.stopCompute(hooks);
	assert.equal(submissions, 1);
	assert.equal(f.state.cost, cost);
});

test("rejected stop followed by missing metadata stays unaccounted", async () => {
	const f = fixture();
	let inspections = 0;
	let submissions = 0;
	await assert.rejects(
		f.lifecycle.stopCompute({
			budget: f.budget,
			inspect: async () => {
				if (inspections++ === 0)
					return { sandbox: { id: "owned-worker", state: "ready" } };
				throw missing();
			},
			request: async () => {
				submissions++;
				throw new Error("submission rejected");
			},
			wait: async () => {},
		}),
		/submission rejected/,
	);
	assert.equal(submissions, 1);
	assert.equal(f.state.cost, 2);
	assert.notEqual(f.state.runningSince, null);
	assert.equal(f.state.shutdownAttempt.completion, undefined);
});

test("prior acknowledged deletion is observation only", async () => {
	const f = fixture({
		workerId: "owned-worker",
		status: "submission-uncertain",
		submissionAcknowledged: true,
		errors: [],
	});
	const result = await f.lifecycle.stopCompute({
		budget: f.budget,
		inspect: async () => {
			throw missing();
		},
		request: async () =>
			assert.fail("a prior acknowledged stop must not repeat"),
		retire: async () => assert.fail("no repeated retirement"),
		cleanup: async () => assert.fail("no repeated cleanup"),
		wait: async () => {},
	});
	assert.equal(result.error, "");
	assert.equal(result.cleanupSkipped, true);
	assert.equal(result.completion.status, "deleted");
	assert.equal(f.state.runningSince, null);
});
