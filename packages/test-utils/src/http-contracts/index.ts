interface Response {
	readonly statusCode: number;
	readonly headers: {
		readonly [key: string]: string | string[] | number | undefined;
	};
	json(): unknown;
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assertHttpErrorContract(
	response: Response,
	protocol: "http" | "graphql" = "http",
): void {
	if (response.statusCode < 400) return;
	const body = response.json();
	if (!record(body)) throw new Error("HTTP error body must be an object");
	const contentType = String(response.headers["content-type"] ?? "").split(
		";",
	)[0];
	if (protocol === "graphql") {
		if (
			!["application/json", "application/graphql-response+json"].includes(
				contentType,
			) ||
			!Array.isArray(body.errors) ||
			!body.errors.length ||
			body.errors.some(
				(error) => !record(error) || typeof error.message !== "string",
			)
		)
			throw new Error("Invalid GraphQL error envelope");
		return;
	}
	if (
		contentType !== "application/problem+json" ||
		body.status !== response.statusCode ||
		typeof body.title !== "string" ||
		!body.title.trim()
	)
		throw new Error("Invalid Problem Details status, title or content type");
	if (typeof body.type !== "string" || body.type === "about:blank")
		throw new Error("Problem Details requires an explicit problem type URI");
	try {
		new URL(body.type);
	} catch {
		throw new Error("Problem Details type must be an absolute URI");
	}
	if (["stack", "stackTrace", "cause"].some((key) => key in body))
		throw new Error("Problem Details exposes diagnostic internals");
}
