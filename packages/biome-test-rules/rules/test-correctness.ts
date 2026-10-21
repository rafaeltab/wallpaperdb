import {
	type AnyJsAstNode,
	type SemanticModel,
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";

type Api = { source: string; name: string; members: string[] };
const testNames = new Set(["expect", "it", "test", "describe", "suite"]);
const testSources = new Set(["vitest", "@playwright/test", "playwright/test"]);

function literal(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function resolveApi(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	seen = new Set<string>(),
): Api | undefined {
	if (!node) return undefined;
	switch (node.kind) {
		case "JS_CALL_EXPRESSION":
			return resolveApi(node.callee, model, seen);
		case "JS_TEMPLATE_EXPRESSION":
			return resolveApi(node.tag, model, seen);
		case "JS_PARENTHESIZED_EXPRESSION":
		case "TS_AS_EXPRESSION":
		case "TS_SATISFIES_EXPRESSION":
			return resolveApi(node.expression, model, seen);
		case "JS_STATIC_MEMBER_EXPRESSION":
		case "JS_COMPUTED_MEMBER_EXPRESSION": {
			const api = resolveApi(node.object, model, seen);
			const member = literal(node.member?.text);
			if (!api || !member) return undefined;
			return api.name === "*"
				? { ...api, name: member }
				: { ...api, members: [...api.members, member] };
		}
		case "JS_IDENTIFIER_EXPRESSION": {
			if (!node.name) return undefined;
			const binding = model.binding(node.name);
			if (!binding)
				return testNames.has(node.text)
					? { source: "global", name: node.text, members: [] }
					: undefined;
			const declaration = binding.syntax();
			// Native handles have no stable JavaScript identity. The lexical scope
			// distinguishes equal spellings in nested scopes and bounds alias cycles.
			const key = `${declaration.text}:${binding.scope().syntax().text}`;
			if (seen.has(key)) return undefined;
			seen.add(key);
			const parent = declaration.parent;
			if (parent?.kind === "JS_VARIABLE_DECLARATOR")
				return resolveApi(parent.initializer?.expression, model, seen);
			const clause = declaration
				.ancestors()
				.find((n) =>
					[
						"JS_IMPORT_NAMED_CLAUSE",
						"JS_IMPORT_NAMESPACE_CLAUSE",
						"JS_IMPORT_COMBINED_CLAUSE",
					].includes(n.kind),
				);
			if (!clause || !("source" in clause)) return undefined;
			const source = literal(clause.source?.text);
			if (!source || !testSources.has(source)) return undefined;
			const name =
				parent?.kind === "JS_NAMESPACE_IMPORT_SPECIFIER"
					? "*"
					: parent?.kind === "JS_NAMED_IMPORT_SPECIFIER"
						? literal(parent.name?.text)
						: declaration.text;
			return name ? { source, name, members: [] } : undefined;
		}
		default:
			return undefined;
	}
}

export const validExpect = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (
			api?.name !== "expect" ||
			api.members.some((m) => !["soft", "poll"].includes(m))
		)
			return;
		const count = node.arguments?.args.length ?? 0;
		let expression = node.parent;
		let members = 0;
		while (
			expression?.kind === "JS_STATIC_MEMBER_EXPRESSION" ||
			expression?.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
		) {
			members++;
			expression = expression.parent;
		}
		if (
			count < 1 ||
			count > 2 ||
			members === 0 ||
			expression?.kind !== "JS_CALL_EXPRESSION"
		)
			registerDiagnostic(
				node,
				"error",
				"Complete the assertion with a matcher and one value plus an optional reason.",
			);
	},
});

function hasRetry(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	seen = new Set<string>(),
): boolean {
	if (!node) return false;
	switch (node.kind) {
		case "JS_PARENTHESIZED_EXPRESSION":
		case "TS_AS_EXPRESSION":
		case "TS_SATISFIES_EXPRESSION":
			return hasRetry(node.expression, model, seen);
		case "JS_IDENTIFIER_EXPRESSION": {
			if (!node.name) return false;
			const binding = model.binding(node.name);
			if (!binding) return false;
			const key = `${binding.syntax().text}:${binding.scope().syntax().text}`;
			if (seen.has(key)) return false;
			seen.add(key);
			const parent = binding.syntax().parent;
			return (
				parent?.kind === "JS_VARIABLE_DECLARATOR" &&
				hasRetry(parent.initializer?.expression, model, seen)
			);
		}
		case "JS_OBJECT_EXPRESSION":
			return node.members.some((member) => {
				if (member.kind === "JS_SPREAD")
					return hasRetry(member.argument, model, seen);
				if (!("name" in member)) return false;
				const name = member.name;
				return (
					literal(
						name?.kind === "JS_COMPUTED_MEMBER_NAME"
							? name.expression?.text
							: name?.text,
					) === "retry"
				);
			});
		default:
			return false;
	}
}

export const noTestRetries = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (
			!api ||
			!["vitest", "global"].includes(api.source) ||
			!["it", "test", "describe", "suite"].includes(api.name)
		)
			return;
		for (const argument of node.arguments?.args.slice(1) ?? []) {
			if (hasRetry(argument, context.model))
				registerDiagnostic(
					argument,
					"error",
					"Use the shared retry policy. Repair failing tests instead of overriding retries.",
				);
		}
	},
});
