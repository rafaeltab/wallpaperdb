import type { TestProject } from "vitest/node";

// Borrow connection information only. The mutation stage owns the server.
export default function setup(project: TestProject) {
	const url = process.env.WALLPAPERDB_MUTATION_OPENSEARCH_URL;
	if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
		throw new Error("Missing owned mutation OpenSearch endpoint");
	project.provide("gatewaySearch", { url, username: "", password: "" });
}
