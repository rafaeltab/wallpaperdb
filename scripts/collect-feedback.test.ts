import { expect } from "vitest";
import { test } from "vitest";
import { collectFeedback } from "./collect-feedback.ts";
const page = <T>(nodes: T[], next: string | null = null) => ({
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
			expect(thread).toBe("thread-1");
			expect(cursor).toBe("more-comments");
			return page([{ id: "comment-2" }]);
		},
		reviews: () => [{ id: "review-1", body: "summary" }],
		conversation: () => [{ id: "conversation-1" }],
	});
	expect(result.threads.map((t) => t.comments.map((c) => c.id))).toStrictEqual([
		["comment-1", "comment-2"],
		["comment-3"],
	]);
	expect(result.reviews[0].id).toBe("review-1");
	expect(result.conversation[0].id).toBe("conversation-1");
});
