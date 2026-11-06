import { github } from "./lib/agent-command.ts";
interface Connection<T> {
	nodes: T[];
	pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}
interface Comment {
	id: string;
	body?: string;
}
interface Thread<C> {
	id: string;
	comments: Connection<C>;
}
function allPages<T>(
	load: (cursor?: string) => Connection<T>,
	initial?: Connection<T>,
) {
	const nodes: T[] = [];
	const cursors = new Set<string>();
	let cursor: string | null | undefined;
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
export function collectFeedback<C, T extends Thread<C>, R, V>(source: {
	threads: (cursor?: string) => Connection<T>;
	comments: (id: string, cursor?: string) => Connection<C>;
	reviews: () => R[];
	conversation: () => V[];
}) {
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
export function githubFeedback(repo: string, number: number) {
	const [owner, name] = repo.split("/");
	const fields =
		"nodes{id databaseId url body createdAt updatedAt author{login} reactionGroups{content viewerHasReacted}} pageInfo{hasNextPage endCursor}";
	const graphql = <T>(
		query: string,
		variables: Record<string, string | number | undefined>,
	): T =>
		github<{ data: T }>([
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
	const rest = (endpoint: string) =>
		github<Record<string, unknown>[][]>([
			"api",
			endpoint,
			"--paginate",
			"--slurp",
		]).flat();
	return collectFeedback<
		Comment,
		Thread<Comment>,
		Record<string, unknown>,
		Record<string, unknown>
	>({
		threads: (cursor) =>
			graphql<{
				repository: {
					pullRequest: { reviewThreads: Connection<Thread<Comment>> };
				};
			}>(
				`query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated viewerCanResolve comments(first:100){${fields}}} pageInfo{hasNextPage endCursor}}}}}`,
				{ owner, name, number, cursor },
			).repository.pullRequest.reviewThreads,
		comments: (id, cursor) =>
			graphql<{ node: { comments: Connection<Comment> } }>(
				`query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){${fields}}}}}`,
				{ id, cursor },
			).node.comments,
		reviews: () => rest(`repos/${repo}/pulls/${number}/reviews`),
		conversation: () => rest(`repos/${repo}/issues/${number}/comments`),
	});
}
