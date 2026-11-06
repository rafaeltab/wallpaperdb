import assert from "node:assert/strict";
import test from "node:test";
import { collectFeedback } from "./collect-feedback.mjs";
const page = (nodes, next = null) => ({
	nodes,
	pageInfo: { hasNextPage: next !== null, endCursor: next },
});
test("feedback collection exhausts outer threads and every inner comment connection", () => {
	const result = collectFeedback({
		threads: (cursor) =>
			cursor
				? page([{ id: "thread-2", comments: page([{ id: "comment-3" }]) }])
				: page(
						[
							{
								id: "thread-1",
								comments: page([{ id: "comment-1" }], "more-comments"),
							},
						],
						"more-threads",
					),
		comments: (thread, cursor) => {
			assert.equal(thread, "thread-1");
			assert.equal(cursor, "more-comments");
			return page([{ id: "comment-2" }]);
		},
		reviews: () => [{ id: "review-1", body: "summary" }],
		conversation: () => [{ id: "conversation-1" }],
	});
	assert.deepEqual(
		result.threads.map((t) => t.comments.map((c) => c.id)),
		[["comment-1", "comment-2"], ["comment-3"]],
	);
	assert.equal(result.reviews[0].id, "review-1");
	assert.equal(result.conversation[0].id, "conversation-1");
});
