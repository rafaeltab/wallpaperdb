import assert from "node:assert/strict";
import test from "node:test";
import { issuePreflight } from "./agent-workflow.mjs";
const ready = () => ({
	state: "OPEN",
	url: "https://github.com/rafaeltab/wallpaperdb/issues/1",
	assignees: [{ login: "agent" }],
	blockedBy: { nodes: [], totalCount: 0 },
	project: { owner: "rafaeltab", number: 7, status: "In Progress" },
});
test("issue preflight rejects closed, unassigned, blocked and wrong-project work", () => {
	assert.deepEqual(issuePreflight(ready(), "agent", "In Progress"), []);
	for (const change of [
		{ state: "CLOSED" },
		{ assignees: [] },
		{ blockedBy: { nodes: [{ state: "OPEN" }], totalCount: 1 } },
		{ project: { owner: "someone", number: 7, status: "In Progress" } },
	])
		assert.ok(
			issuePreflight({ ...ready(), ...change }, "agent", "In Progress").length,
		);
});
