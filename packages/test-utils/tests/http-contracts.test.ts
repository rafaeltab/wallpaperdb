import { expect, it } from "vitest";
import { assertHttpErrorContract } from "../src/http-contracts/index.js";
const response = (
	body: unknown,
	contentType = "application/problem+json",
	statusCode = 400,
) => ({
	statusCode,
	headers: { "content-type": contentType },
	json: () => body,
});
it("requires explicit Problem Details types, matching statuses and safe error structure", () => {
	expect(() =>
		assertHttpErrorContract(
			response({
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-request.md",
				status: 400,
				title: "Invalid request",
			}),
		),
	).not.toThrow();
	for (const body of [
		{ type: "about:blank", status: 400, title: "Invalid" },
		{ type: "https://example.com/type", status: 500, title: "Invalid" },
		{
			type: "https://example.com/type",
			status: 400,
			title: "Invalid",
			stack: "private",
		},
	])
		expect(() => assertHttpErrorContract(response(body))).toThrow();
});
it("retains GraphQL error envelopes without treating REST errors as GraphQL", () => {
	const result = response(
		{
			errors: [{ message: "Invalid request", extensions: { code: "INVALID" } }],
		},
		"application/json",
	);
	expect(() => assertHttpErrorContract(result, "graphql")).not.toThrow();
	expect(() => assertHttpErrorContract(result)).toThrow();
});

it("validates HEAD error headers without requiring a response body", () => {
	const head = {
		statusCode: 404,
		headers: { "content-type": "application/problem+json" },
		raw: { req: { method: "HEAD" } },
		json: () => {
			throw new Error("HEAD has no body");
		},
	};
	expect(() => assertHttpErrorContract(head)).not.toThrow();
	expect(() =>
		assertHttpErrorContract({
			...head,
			headers: { "content-type": "text/html" },
		}),
	).toThrow();
});
