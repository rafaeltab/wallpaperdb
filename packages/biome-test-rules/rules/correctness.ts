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
	"effect",
	"effect/Effect",
	"node:test",
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
		!call.arguments?.args.slice(1, 3).some((arg) => arg.text === fn.text)
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
			const writes = binding.allWrites();
			if (parent?.kind === "JS_VARIABLE_DECLARATOR") {
				if (writes.length === 0)
					return resolveApi(parent.initializer?.expression, model, seen);
				if (parent.initializer || writes.length !== 1) return undefined;
				const assignment = writes[0]?.syntax().parent;
				if (
					assignment?.kind !== "JS_ASSIGNMENT_EXPRESSION" ||
					assignment.operatorToken !== "=" ||
					assignment.parent?.kind !== "JS_EXPRESSION_STATEMENT"
				)
					return undefined;
				const statement = assignment.parent;
				const list = statement.parent;
				if (
					!list ||
					!["JS_MODULE_ITEM_LIST", "JS_STATEMENT_LIST"].includes(list.kind)
				)
					return undefined;
				const use = node
					.ancestors()
					.find(
						(ancestor) =>
							ancestor.parent?.kind === list.kind &&
							ancestor.parent.text === list.text,
					);
				const siblings = list.children();
				// Follow only a unique, preceding assignment in this statement list.
				// Conditional writes, nested consumers and repeated writes need flow analysis.
				if (
					!use ||
					siblings.filter((s) => s.text === statement.text).length !== 1 ||
					siblings.filter((s) => s.text === use.text).length !== 1 ||
					siblings.findIndex((s) => s.text === statement.text) >=
						siblings.findIndex((s) => s.text === use.text)
				)
					return undefined;
				return resolveApi(assignment.right, model, seen);
			}
			if (writes.length !== 0) return undefined;
			if (
				parent?.kind === "JS_OBJECT_BINDING_PATTERN_PROPERTY" ||
				parent?.kind === "JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY"
			) {
				const declarator = declaration
					.ancestors()
					.find((ancestor) => ancestor.kind === "JS_VARIABLE_DECLARATOR");
				if (
					declarator?.kind !== "JS_VARIABLE_DECLARATOR" ||
					declarator.id?.kind !== "JS_OBJECT_BINDING_PATTERN" ||
					parent.init
				)
					return undefined;
				const api = resolveApi(declarator.initializer?.expression, model, seen);
				const member =
					parent.kind === "JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY"
						? declaration.text
						: parent.member?.kind === "JS_LITERAL_MEMBER_NAME"
							? literal(parent.member.text)
							: undefined;
				if (!api || !member) return undefined;
				return api.name === "*"
					? { ...api, name: member }
					: { ...api, members: [...api.members, member] };
			}
			const clause = declaration
				.ancestors()
				.find((n) =>
					[
						"JS_IMPORT_NAMED_CLAUSE",
						"JS_IMPORT_NAMESPACE_CLAUSE",
						"JS_IMPORT_COMBINED_CLAUSE",
						"JS_IMPORT_DEFAULT_CLAUSE",
					].includes(n.kind),
				);
			if (!clause || !("source" in clause)) return undefined;
			const source = literal(clause.source?.text);
			if (!source || !testSources.has(source)) return undefined;
			const name =
				parent?.kind === "JS_NAMESPACE_IMPORT_SPECIFIER"
					? "*"
					: parent?.kind === "JS_DEFAULT_IMPORT_SPECIFIER" &&
							source === "node:test"
						? "test"
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

function definitelyFalsy(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	seen = new Set<string>(),
): boolean {
	if (!node) return false;
	if (
		[
			"JS_PARENTHESIZED_EXPRESSION",
			"TS_AS_EXPRESSION",
			"TS_SATISFIES_EXPRESSION",
			"TS_NON_NULL_ASSERTION_EXPRESSION",
		].includes(node.kind) &&
		"expression" in node
	)
		return definitelyFalsy(node.expression, model, seen);
	const identifier =
		node.kind === "JS_IDENTIFIER_EXPRESSION"
			? node.name
			: node.kind === "JS_REFERENCE_IDENTIFIER"
				? node
				: undefined;
	if (identifier) {
		const binding = model.binding(identifier);
		if (!binding) return node.text === "undefined";
		const declaration = binding.syntax();
		const parent = declaration.parent;
		const variable = declaration
			.ancestors()
			.find((n) => n.kind === "JS_VARIABLE_DECLARATION");
		if (
			parent?.kind !== "JS_VARIABLE_DECLARATOR" ||
			variable?.kind !== "JS_VARIABLE_DECLARATION" ||
			variable.kindToken !== "const" ||
			binding.allWrites().length !== 0
		)
			return false;
		const key = `${declaration.text}:${binding.scope().syntax().text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return definitelyFalsy(parent.initializer?.expression, model, seen);
	}
	if (node.kind === "JS_UNARY_EXPRESSION" && node.operatorToken === "void")
		return true;
	return ["false", "null", "0", "''", '""'].includes(node.text);
}

function hasOption(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	option = "retry",
	seen = new Set<string>(),
): boolean {
	if (!node) return false;
	switch (node.kind) {
		case "JS_PARENTHESIZED_EXPRESSION":
		case "TS_AS_EXPRESSION":
		case "TS_SATISFIES_EXPRESSION":
		case "TS_NON_NULL_ASSERTION_EXPRESSION":
			return hasOption(node.expression, model, option, seen);
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
				hasOption(parent.initializer?.expression, model, option, seen)
			);
		}
		case "JS_OBJECT_EXPRESSION":
			return node.members.some((member) => {
				if (member.kind === "JS_SPREAD")
					return hasOption(member.argument, model, option, seen);
				if (!("name" in member)) return false;
				const name = member.name;
				return (
					literal(
						name?.kind === "JS_COMPUTED_MEMBER_NAME"
							? name.expression?.kind === "JS_STRING_LITERAL_EXPRESSION"
								? name.expression.text
								: undefined
							: name?.text,
					) === option &&
					(option !== "todo" ||
						!definitelyFalsy(
							member.kind === "JS_PROPERTY_OBJECT_MEMBER"
								? member.value
								: member.kind === "JS_SHORTHAND_PROPERTY_OBJECT_MEMBER"
									? member.name
									: undefined,
							model,
						))
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
			if (hasOption(argument, context.model))
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
		const args = node.arguments?.args ?? [];
		if (
			api &&
			["it", "test", "describe", "suite"].includes(api.name) &&
			(api.members.includes("todo") ||
				(api.source === "node:test" && api.members.length === 0
					? !potentialCallback(args.at(-1), context.model) ||
						args.some((arg) => hasOption(arg, context.model, "todo"))
					: args.length < 2 && api.members.length === 0))
		) {
			registerDiagnostic(
				node,
				"error",
				"Track unfinished tests in an issue rather than a passing placeholder.",
			);
		}
	},
});

export const noAliasedTestModifiers = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (
			!api ||
			!["it", "test", "describe", "suite"].includes(api.name) ||
			!api.members.some((member) => ["only", "skip"].includes(member))
		)
			return;
		const callee = node.callee;
		// Biome's built-ins cover direct registrations, including their existing
		// issue-linked suppressions. Fill aliases and namespace chains here.
		if (
			callee?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
			callee.object?.kind === "JS_IDENTIFIER_EXPRESSION" &&
			["it", "test", "describe", "suite"].includes(callee.object.text)
		)
			return;
		registerDiagnostic(
			node,
			"error",
			"Do not focus or disable tests through registration aliases.",
		);
	},
});

function potentialCallback(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	seen = new Set<string>(),
): boolean {
	if (!node) return false;
	if (
		[
			"JS_PARENTHESIZED_EXPRESSION",
			"TS_AS_EXPRESSION",
			"TS_SATISFIES_EXPRESSION",
			"TS_NON_NULL_ASSERTION_EXPRESSION",
		].includes(node.kind) &&
		"expression" in node
	)
		return potentialCallback(node.expression, model, seen);
	if (node.kind === "JS_IDENTIFIER_EXPRESSION" && node.name) {
		const binding = model.binding(node.name);
		if (!binding) return node.text !== "undefined";
		const declaration = binding.syntax();
		const key = `${declaration.text}:${binding.scope().syntax().text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		if (
			declaration.parent?.kind === "JS_VARIABLE_DECLARATOR" &&
			binding.allWrites().length === 0
		)
			return potentialCallback(
				declaration.parent.initializer?.expression,
				model,
				seen,
			);
	}
	if (node.kind === "JS_UNARY_EXPRESSION" && node.operatorToken === "void")
		return false;
	// Unknown imported/parameter bindings may be legitimate handlers. Reject
	// provably non-callable values without inventing cross-module type inference.
	return ![
		"JS_NULL_LITERAL_EXPRESSION",
		"JS_BOOLEAN_LITERAL_EXPRESSION",
		"JS_NUMBER_LITERAL_EXPRESSION",
		"JS_STRING_LITERAL_EXPRESSION",
		"JS_OBJECT_EXPRESSION",
		"JS_ARRAY_EXPRESSION",
	].includes(node.kind);
}

function callbackResultHandled(
	node: AnyJsAstNode,
	model: SemanticModel,
	seen: Set<string>,
	allowVoid: boolean,
): boolean {
	const parent = node.parent;
	if (parent?.kind === "JS_PARENTHESIZED_EXPRESSION")
		return callbackResultHandled(parent, model, seen, allowVoid);
	if (
		parent?.kind === "JS_CALL_EXPRESSION" &&
		parent.callee?.text === node.text
	)
		return handled(parent, model, seen, allowVoid);
	if (
		parent?.kind === "JS_INITIALIZER_CLAUSE" &&
		parent.parent?.kind === "JS_VARIABLE_DECLARATOR" &&
		parent.parent.id?.kind === "JS_IDENTIFIER_BINDING"
	) {
		const binding = model.asBinding(parent.parent.id);
		if (!binding || binding.allWrites().length !== 0) return false;
		const key = `callback:${binding.syntax().text}:${binding.scope().syntax().text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return binding.allReads().some((read) => {
			const expression = read.syntax().parent;
			return (
				expression?.kind === "JS_IDENTIFIER_EXPRESSION" &&
				callbackResultHandled(expression, model, seen, allowVoid)
			);
		});
	}
	if (parent?.kind !== "JS_CALL_ARGUMENT_LIST") return false;
	const call = parent.parent?.parent;
	if (call?.kind !== "JS_CALL_EXPRESSION") return false;
	const api = resolveApi(call.callee, model);
	if (api?.name === "expect" && api.members.at(-1) === "poll") {
		let result: AnyJsAstNode = call;
		while (
			result.parent?.kind === "JS_STATIC_MEMBER_EXPRESSION" ||
			result.parent?.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
		) {
			result = result.parent;
			if (result.parent?.kind === "JS_CALL_EXPRESSION") result = result.parent;
		}
		return (
			result.kind === "JS_CALL_EXPRESSION" &&
			result.text !== call.text &&
			handled(result, model, seen, allowVoid)
		);
	}
	if (
		api &&
		((api.source === "effect" &&
			api.name === "Effect" &&
			api.members.length === 1 &&
			["promise", "tryPromise"].includes(api.members[0] ?? "")) ||
			(api.source === "effect/Effect" &&
				api.members.length === 0 &&
				["promise", "tryPromise"].includes(api.name)))
	)
		return true;
	if (api && ["it", "test", "describe", "suite"].includes(api.name))
		return true;
	if (
		api &&
		["vitest", "@effect/vitest", "node:test"].includes(api.source) &&
		["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(api.name)
	)
		return true;
	const callee = call.callee;
	if (callee?.kind !== "JS_STATIC_MEMBER_EXPRESSION") return false;
	if (["then", "catch", "finally"].includes(callee.member?.text ?? ""))
		return handled(call, model, seen, allowVoid);
	if (callee.member?.text === "map") {
		const aggregate = call.parent?.parent?.parent;
		return (
			aggregate?.kind === "JS_CALL_EXPRESSION" &&
			/^Promise\.(all|allSettled|race|any)$/.test(
				aggregate.callee?.text ?? "",
			) &&
			aggregate.arguments?.args[0]?.text === call.text &&
			handled(aggregate, model, seen, allowVoid)
		);
	}
	return false;
}

function handled(
	node: AnyJsAstNode,
	model: SemanticModel,
	seen = new Set<string>(),
	allowVoid = false,
): boolean {
	const parent = node.parent;
	if (!parent) return false;
	switch (parent.kind) {
		case "JS_CONDITIONAL_EXPRESSION":
			return (
				parent.test?.text !== node.text &&
				handled(parent, model, seen, allowVoid)
			);
		case "JS_ASSIGNMENT_EXPRESSION": {
			if (
				parent.left?.kind !== "JS_IDENTIFIER_ASSIGNMENT" ||
				parent.operatorToken !== "="
			)
				return false;
			const binding = model.binding(parent.left);
			if (!binding) return false;
			const key = `${binding.syntax().text}:${binding.scope().syntax().text}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return binding.allReads().some((reference) => {
				const expression = reference.syntax().parent;
				return (
					expression?.kind === "JS_IDENTIFIER_EXPRESSION" &&
					handled(expression, model, seen, allowVoid)
				);
			});
		}
		case "JS_UNARY_EXPRESSION":
			return allowVoid && parent.operatorToken === "void";
		case "JS_AWAIT_EXPRESSION":
		case "JS_RETURN_STATEMENT":
			return true;
		case "JS_ARROW_FUNCTION_EXPRESSION":
			// A helper property declares a function return contract. It is not a
			// callback argument whose consumer can discard the returned promise.
			if (parent.parent?.kind === "JS_PROPERTY_OBJECT_MEMBER") return true;
			return callbackResultHandled(parent, model, seen, allowVoid);
		case "JS_PARENTHESIZED_EXPRESSION":
		case "TS_AS_EXPRESSION":
		case "TS_SATISFIES_EXPRESSION":
		case "TS_NON_NULL_ASSERTION_EXPRESSION":
			return handled(parent, model, seen, allowVoid);
		case "JS_STATIC_MEMBER_EXPRESSION": {
			const call = parent.parent;
			if (call?.kind !== "JS_CALL_EXPRESSION") return false;
			const args = call.arguments?.args;
			if (
				parent.member?.text === "catch" &&
				potentialCallback(args?.[0], model)
			)
				return true;
			if (parent.member?.text === "then" && potentialCallback(args?.[1], model))
				return true;
			return handled(call, model, seen, allowVoid);
		}
		case "JS_INITIALIZER_CLAUSE": {
			const declaration = parent.parent;
			if (
				declaration?.kind !== "JS_VARIABLE_DECLARATOR" ||
				declaration.id?.kind !== "JS_IDENTIFIER_BINDING"
			)
				return false;
			const binding = model.asBinding(declaration.id);
			if (!binding) return false;
			const key = `${binding.syntax().text}:${binding.scope().syntax().text}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return binding.allReads().some((reference) => {
				const expression = reference.syntax().parent;
				return (
					expression?.kind === "JS_IDENTIFIER_EXPRESSION" &&
					handled(expression, model, seen, allowVoid)
				);
			});
		}
		case "JS_ARRAY_ELEMENT_LIST":
		case "JS_ARRAY_EXPRESSION":
		case "JS_CALL_ARGUMENT_LIST":
		case "JS_CALL_ARGUMENTS": {
			let call: AnyJsAstNode | undefined = parent;
			let arrays = 0;
			while (
				call &&
				[
					"JS_ARRAY_ELEMENT_LIST",
					"JS_ARRAY_EXPRESSION",
					"JS_CALL_ARGUMENT_LIST",
					"JS_CALL_ARGUMENTS",
				].includes(call.kind)
			) {
				if (call.kind === "JS_ARRAY_EXPRESSION") arrays++;
				call = call.parent;
			}
			if (
				arrays === 0 &&
				call?.kind === "JS_CALL_EXPRESSION" &&
				resolveApi(call.callee, model)?.name === "expect"
			) {
				let result: AnyJsAstNode = call;
				while (
					result.parent?.kind === "JS_STATIC_MEMBER_EXPRESSION" ||
					result.parent?.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
				) {
					result = result.parent;
					if (result.parent?.kind === "JS_CALL_EXPRESSION")
						result = result.parent;
				}
				if (result.kind === "JS_CALL_EXPRESSION") {
					const api = resolveApi(result.callee, model);
					if (api?.members.some((m) => ["resolves", "rejects"].includes(m)))
						return handled(result, model, seen, allowVoid);
				}
			}
			return (
				arrays === 1 &&
				call?.kind === "JS_CALL_EXPRESSION" &&
				/^Promise\.(all|allSettled|race|any)$/.test(call.callee?.text ?? "") &&
				handled(call, model, seen, allowVoid)
			);
		}
		default:
			return false;
	}
}

export const awaitAsyncAssertions = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (
			api?.name !== "expect" ||
			!["vitest", "@effect/vitest", "global"].includes(api.source)
		)
			return;
		if (!api.members.some((m) => ["poll", "resolves", "rejects"].includes(m)))
			return;
		if (
			[
				"poll",
				"soft",
				"not",
				"resolves",
				"rejects",
				"then",
				"catch",
				"finally",
			].includes(api.members.at(-1) ?? "")
		)
			return;
		if (!handled(node, context.model))
			registerDiagnostic(
				node,
				"error",
				"Await or return this async assertion, or handle its rejection.",
			);
	},
});

export const handleEffectPromises = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		if (!api) return;
		const method =
			api.source === "effect" &&
			api.name === "Effect" &&
			api.members.length === 1
				? api.members[0]
				: api.source === "effect/Effect" && api.members.length === 0
					? api.name
					: undefined;
		if (
			method &&
			["runPromise", "runPromiseExit"].includes(method) &&
			!handled(node, context.model, new Set(), true)
		) {
			registerDiagnostic(
				node,
				"error",
				"Handle this Effect promise with await, return, or a rejection handler, or explicitly discard it with void.",
			);
		}
	},
});
