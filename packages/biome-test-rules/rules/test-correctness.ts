import {
	type AnyJsAstNode,
	type SemanticModel,
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";

type Api = { source: string; name: string; members: string[] };
const testNames = new Set(["expect", "it", "test", "describe", "suite"]);
const testSources = new Set([
	"vitest",
	"@effect/vitest",
	"@playwright/test",
	"playwright/test",
]);

function literal(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function taskContextApi(
	declaration: AnyJsAstNode,
	model: SemanticModel,
	seen: Set<string>,
): Api | undefined {
	const parameter = declaration
		.ancestors()
		.find((n) => n.kind === "JS_FORMAL_PARAMETER");
	const fn = declaration
		.ancestors()
		.find(
			(n) =>
				n.kind === "JS_ARROW_FUNCTION_EXPRESSION" ||
				n.kind === "JS_FUNCTION_EXPRESSION",
		);
	if (!fn || !("parameters" in fn) || !fn.parameters) return undefined;
	const call = fn.parent?.parent?.parent;
	if (
		call?.kind !== "JS_CALL_EXPRESSION" ||
		call.arguments?.args.at(-1)?.text !== fn.text
	)
		return undefined;
	const registration = resolveApi(call.callee, model, seen);
	if (
		!registration ||
		!["vitest", "@effect/vitest", "global"].includes(registration.source) ||
		!["it", "test"].includes(registration.name) ||
		registration.members.includes("each")
	)
		return undefined;
	const index =
		fn.parameters.kind === "JS_PARAMETERS"
			? fn.parameters.items.findIndex((p) => p.text === parameter?.text)
			: fn.parameters.text === declaration.text
				? 0
				: -1;
	if (index !== (registration.members.includes("for") ? 1 : 0))
		return undefined;
	const parent = declaration.parent;
	if (
		fn.parameters.kind === "JS_IDENTIFIER_BINDING" ||
		(parameter?.kind === "JS_FORMAL_PARAMETER" &&
			parameter.binding?.kind === "JS_IDENTIFIER_BINDING")
	)
		return { source: registration.source, name: "<context>", members: [] };
	if (
		parent?.kind === "JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY" &&
		declaration.text === "expect"
	)
		return { source: registration.source, name: "expect", members: [] };
	if (
		parent?.kind === "JS_OBJECT_BINDING_PATTERN_PROPERTY" &&
		literal(parent.member?.text) === "expect"
	)
		return { source: registration.source, name: "expect", members: [] };
	return undefined;
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
		case "TS_NON_NULL_ASSERTION_EXPRESSION":
			return resolveApi(node.expression, model, seen);
		case "JS_STATIC_MEMBER_EXPRESSION":
		case "JS_COMPUTED_MEMBER_EXPRESSION": {
			const api = resolveApi(node.object, model, seen);
			const member =
				node.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
					? node.member?.kind === "JS_STRING_LITERAL_EXPRESSION"
						? literal(node.member.text)
						: undefined
					: literal(node.member?.text);
			if (!api || !member) return undefined;
			if (api.name === "<context>")
				return member === "expect" ? { ...api, name: "expect" } : undefined;
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
			const contextApi = taskContextApi(declaration, model, seen);
			if (contextApi) return contextApi;
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
		let matcher: string | undefined;
		while (expression) {
			if (
				[
					"JS_PARENTHESIZED_EXPRESSION",
					"TS_AS_EXPRESSION",
					"TS_SATISFIES_EXPRESSION",
					"TS_NON_NULL_ASSERTION_EXPRESSION",
				].includes(expression.kind)
			) {
				expression = expression.parent;
			} else if (
				expression.kind === "JS_STATIC_MEMBER_EXPRESSION" ||
				expression.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
			) {
				matcher =
					expression.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
						? expression.member?.kind === "JS_STRING_LITERAL_EXPRESSION"
							? literal(expression.member.text)
							: "<computed matcher>"
						: literal(expression.member?.text);
				expression = expression.parent;
			} else break;
		}
		if (
			count < 1 ||
			count > 2 ||
			!matcher ||
			["not", "resolves", "rejects"].includes(matcher) ||
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
							? name.expression?.kind === "JS_STRING_LITERAL_EXPRESSION"
								? name.expression.text
								: undefined
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
			!["vitest", "@effect/vitest", "global"].includes(api.source) ||
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

export const noTodoTests = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (
			api &&
			["it", "test", "describe", "suite"].includes(api.name) &&
			(api.members.includes("todo") ||
				((node.arguments?.args.length ?? 0) < 2 && api.members.length === 0))
		) {
			registerDiagnostic(
				node,
				"error",
				"Track unfinished tests in an issue rather than a passing placeholder.",
			);
		}
	},
});
