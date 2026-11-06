import { github } from "./lib/agent-command.mjs";
function allPages(load, initial) {
	const nodes = [];
	const cursors = new Set();
	let cursor;
	let page = initial ?? load();
	while (true) {
		if (
			!Array.isArray(page?.nodes) ||
			typeof page?.pageInfo?.hasNextPage !== "boolean"
		)
			throw new Error("Incomplete feedback connection");
		nodes.push(...page.nodes);
		if (!page.pageInfo.hasNextPage) break;
		cursor = page.pageInfo.endCursor;
		if (!cursor || cursors.has(cursor))
			throw new Error("Feedback pagination did not advance");
		cursors.add(cursor);
		page = load(cursor);
	}
	return nodes;
}
export function collectFeedback(source) {
	const threads = allPages(source.threads).map((thread) => ({
		...thread,
		comments: allPages(
			(cursor) => source.comments(thread.id, cursor),
			thread.comments,
		),
	}));
	return {
		threads,
		reviews: source.reviews(),
		conversation: source.conversation(),
	};
}
export function githubFeedback(repo, number) {
	const [owner, name] = repo.split("/");
	const fields =
		"nodes{id databaseId url body createdAt updatedAt author{login} reactionGroups{content viewerHasReacted}} pageInfo{hasNextPage endCursor}";
	const graphql = (query, variables) =>
		github([
			"api",
			"graphql",
			"-f",
			`query=${query}`,
			...Object.entries(variables)
				.filter(([, v]) => v !== undefined)
				.flatMap(([k, v]) => [
					typeof v === "number" ? "-F" : "-f",
					`${k}=${v}`,
				]),
		]).data;
	const rest = (endpoint) =>
		github(["api", endpoint, "--paginate", "--slurp"]).flat();
	return collectFeedback({
		threads: (cursor) =>
			graphql(
				`query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated viewerCanResolve comments(first:100){${fields}}} pageInfo{hasNextPage endCursor}}}}}`,
				{ owner, name, number, cursor },
			).repository.pullRequest.reviewThreads,
		comments: (id, cursor) =>
			graphql(
				`query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){${fields}}}}}`,
				{ id, cursor },
			).node.comments,
		reviews: () => rest(`repos/${repo}/pulls/${number}/reviews`),
		conversation: () => rest(`repos/${repo}/issues/${number}/comments`),
	});
}
