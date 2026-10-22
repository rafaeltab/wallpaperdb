import {
	type AnyJsAstNode,
	type SemanticModel,
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";

type Api = {
	source: string;
	name: string;
	members: string[];
	pendingFactory?: boolean;
};
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

function decodeEscapes(text: string): string {
	// The public CST API exposes raw tokens, not cooked strings. Decode only
	// JavaScript string/template escapes; never evaluate source text.
	return text.replace(
		/\\(?:u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])/g,
		(sequence) => {
			const value = sequence.slice(1);
			if (value.startsWith("u") || value.startsWith("x")) {
				const digits = value.startsWith("u{")
					? value.slice(2, -1)
					: value.slice(1);
				const code = Number.parseInt(digits, 16);
				return code <= 0x10ffff ? String.fromCodePoint(code) : sequence;
			}
			if (["\n", "\r", "\r\n", "\u2028", "\u2029"].includes(value)) return "";
			const controls: Record<string, string> = {
				"0": "\0",
				b: "\b",
				f: "\f",
				n: "\n",
				r: "\r",
				t: "\t",
				v: "\v",
			};
			return controls[value] ?? value;
		},
	);
}

function literal(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return /^(['"])[\s\S]*\1$/.test(text)
		? decodeEscapes(text.slice(1, -1))
		: decodeEscapes(text);
}

function importedApi(source: string, name: string): Api {
	const modifier =
		source === "node:test" && ["skip", "only", "todo"].includes(name);
	return {
		source,
		name:
			source === "node:test" && (name === "default" || modifier)
				? "test"
				: name,
		members: modifier ? [name] : [],
	};
}

function apiMember(api: Api, member: string): Api | undefined {
	if (api.name === "<context>")
		return member === "expect" ? { ...api, name: "expect" } : undefined;
	if (api.name === "<nodeContext>") {
		if (member === "test") return { ...api, name: "test" };
		if (["before", "after", "beforeEach", "afterEach"].includes(member))
			return { ...api, name: member, members: [] };
		return ["skip", "todo"].includes(member)
			? { ...api, name: "test", members: [member] }
			: undefined;
	}
	if (api.name === "*") return importedApi(api.source, member);
	return {
		...api,
		members: [...api.members, member],
		pendingFactory:
			api.pendingFactory ||
			(["vitest", "@effect/vitest", "global"].includes(api.source) &&
				["it", "test", "describe", "suite"].includes(api.name) &&
				["each", "for", "extend", "skipIf", "runIf"].includes(member)),
	};
}

function statementPosition(node: AnyJsAstNode) {
	const statement = node
		.ancestors()
		.find((ancestor) =>
			["JS_MODULE_ITEM_LIST", "JS_STATEMENT_LIST"].includes(
				ancestor.parent?.kind ?? "",
			),
		);
	const list = statement?.parent;
	if (!statement || !list) return undefined;
	const siblings = list.children();
	if (siblings.filter((s) => s.text === statement.text).length !== 1)
		return undefined;
	return { list, index: siblings.findIndex((s) => s.text === statement.text) };
}

function variableValueAt(node: AnyJsAstNode, model: SemanticModel) {
	if (node.kind !== "JS_IDENTIFIER_EXPRESSION" || !node.name) return undefined;
	const binding = model.binding(node.name);
	const declaration = binding?.syntax().parent;
	if (!binding || declaration?.kind !== "JS_VARIABLE_DECLARATOR")
		return undefined;
	const writes = binding.allWrites();
	if (writes.length === 0) return declaration.initializer?.expression;
	if (writes.length !== 1) return undefined;
	const assignment = writes[0]?.syntax().parent;
	if (
		assignment?.kind !== "JS_ASSIGNMENT_EXPRESSION" ||
		assignment.operatorToken !== "=" ||
		assignment.parent?.kind !== "JS_EXPRESSION_STATEMENT" ||
		!["JS_MODULE_ITEM_LIST", "JS_STATEMENT_LIST"].includes(
			assignment.parent.parent?.kind ?? "",
		)
	)
		return undefined;
	const assigned = statementPosition(assignment);
	const used = statementPosition(node);
	// Resolve one straight-line write in the same statement list. Conditional,
	// nested or repeated writes need flow analysis and remain unresolved.
	if (
		!assigned ||
		!used ||
		assigned.list.kind !== used.list.kind ||
		assigned.list.text !== used.list.text ||
		assigned.index === used.index
	)
		return undefined;
	return assigned.index < used.index
		? assignment.right
		: declaration.initializer?.expression;
}

function taskContextApi(
	declaration: AnyJsAstNode,
	model: SemanticModel,
	seen: Set<string>,
): Api | undefined {
	const parameter = declaration
		.ancestors()
		.find((n) => n.kind === "JS_FORMAL_PARAMETER");
	// Stop at the nearest parameter-owning function, including declarations and
	// methods, so a nested function's parameter cannot inherit an outer context.
	const fn = declaration.ancestors().find((n) => "parameters" in n);
	if (
		!fn ||
		(fn.kind !== "JS_ARROW_FUNCTION_EXPRESSION" &&
			fn.kind !== "JS_FUNCTION_EXPRESSION") ||
		!fn.parameters
	)
		return undefined;
	if (!parameter && declaration.parent?.kind !== "JS_ARROW_FUNCTION_EXPRESSION")
		return undefined;
	const call = fn.parent?.parent?.parent;
	if (call?.kind !== "JS_CALL_EXPRESSION") return undefined;
	const registration = resolveApi(call.callee, model, seen);
	if (
		!registration ||
		!["vitest", "@effect/vitest", "global", "node:test"].includes(
			registration.source,
		) ||
		!["it", "test"].includes(registration.name) ||
		registration.members.includes("each")
	)
		return undefined;
	const nodeContext = registration.source === "node:test";
	if (
		!call.arguments?.args
			.slice(nodeContext ? 0 : 1, 3)
			.some((arg) => arg.text === fn.text)
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
		return {
			source: registration.source,
			name: nodeContext ? "<nodeContext>" : "<context>",
			members: [],
		};
	const member =
		parent?.kind === "JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY"
			? declaration.text
			: parent?.kind === "JS_OBJECT_BINDING_PATTERN_PROPERTY"
				? staticMemberName(parent.member)
				: undefined;
	return member
		? apiMember(
				{
					source: registration.source,
					name: nodeContext ? "<nodeContext>" : "<context>",
					members: [],
				},
				member,
			)
		: undefined;
}

function resolveApi(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	seen = new Set<string>(),
): Api | undefined {
	if (!node) return undefined;
	switch (node.kind) {
		case "JS_CALL_EXPRESSION": {
			const api = resolveApi(node.callee, model, seen);
			return api ? { ...api, pendingFactory: false } : undefined;
		}
		case "JS_TEMPLATE_EXPRESSION": {
			const api = resolveApi(node.tag, model, seen);
			return api ? { ...api, pendingFactory: false } : undefined;
		}
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
					? staticComputedKey(node.member)
					: literal(node.member?.text);
			if (!api || !member) return undefined;
			return apiMember(api, member);
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
			if (parent?.kind === "JS_VARIABLE_DECLARATOR")
				return resolveApi(variableValueAt(node, model), model, seen);
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
						: staticMemberName(parent.member);
				if (!api || !member) return undefined;
				return apiMember(api, member);
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
			return name ? importedApi(source, name) : undefined;
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
						? (staticComputedKey(expression.member) ?? "<computed matcher>")
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
	stringReasons = false,
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
		return definitelyFalsy(node.expression, model, seen, stringReasons);
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
		return definitelyFalsy(
			parent.initializer?.expression,
			model,
			seen,
			stringReasons,
		);
	}
	if (node.kind === "JS_UNARY_EXPRESSION" && node.operatorToken === "void")
		return true;
	return (
		["false", "null", "0"].includes(node.text) ||
		(!stringReasons && staticComputedKey(node) === "")
	);
}

function staticComputedKey(node: AnyJsAstNode | undefined): string | undefined {
	if (node?.kind === "JS_STRING_LITERAL_EXPRESSION") return literal(node.text);
	if (
		node?.kind === "JS_TEMPLATE_EXPRESSION" &&
		!node.tag &&
		node.elements.every(
			(element) => element.kind === "JS_TEMPLATE_CHUNK_ELEMENT",
		)
	)
		return decodeEscapes(node.elements.map((element) => element.text).join(""));
	return undefined;
}

function staticMemberName(node: AnyJsAstNode | undefined): string | undefined {
	if (node?.kind === "JS_COMPUTED_MEMBER_NAME")
		return staticComputedKey(node.expression);
	return node?.kind === "JS_LITERAL_MEMBER_NAME" ||
		node?.kind === "JS_REFERENCE_IDENTIFIER"
		? literal(node.text)
		: undefined;
}

const optionAbsent = 1;
const optionDisabled = 2;
const optionEnabled = 4;

function optionStates(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	option: string,
	seen = new Set<string>(),
	stringReasons = false,
): number {
	if (!node) return optionAbsent;
	switch (node.kind) {
		case "JS_PARENTHESIZED_EXPRESSION":
		case "TS_AS_EXPRESSION":
		case "TS_SATISFIES_EXPRESSION":
		case "TS_NON_NULL_ASSERTION_EXPRESSION":
			return optionStates(node.expression, model, option, seen, stringReasons);
		case "JS_IDENTIFIER_EXPRESSION": {
			if (!node.name) return optionAbsent;
			const binding = model.binding(node.name);
			if (!binding) return optionAbsent;
			const key = `${binding.syntax().text}:${binding.scope().syntax().text}`;
			if (seen.has(key)) return optionAbsent;
			seen.add(key);
			return optionStates(
				variableValueAt(node, model),
				model,
				option,
				seen,
				stringReasons,
			);
		}
		case "JS_CONDITIONAL_EXPRESSION":
			return (
				optionStates(
					node.consequent,
					model,
					option,
					new Set(seen),
					stringReasons,
				) |
				optionStates(
					node.alternate,
					model,
					option,
					new Set(seen),
					stringReasons,
				)
			);
		case "JS_LOGICAL_EXPRESSION": {
			let left = node.left;
			while (
				left &&
				[
					"JS_PARENTHESIZED_EXPRESSION",
					"TS_AS_EXPRESSION",
					"TS_SATISFIES_EXPRESSION",
					"TS_NON_NULL_ASSERTION_EXPRESSION",
				].includes(left.kind) &&
				"expression" in left
			)
				left = left.expression;
			if (node.operatorToken === "&&") {
				if (definitelyFalsy(left, model)) return optionAbsent;
				const right = optionStates(
					node.right,
					model,
					option,
					seen,
					stringReasons,
				);
				return left?.kind === "JS_OBJECT_EXPRESSION" || left?.text === "true"
					? right
					: optionAbsent | right;
			}
			if (left?.kind === "JS_OBJECT_EXPRESSION")
				return optionStates(left, model, option, seen, stringReasons);
			return (
				optionStates(left, model, option, new Set(seen), stringReasons) |
				optionStates(node.right, model, option, new Set(seen), stringReasons)
			);
		}
		case "JS_OBJECT_EXPRESSION": {
			let states = optionAbsent;
			for (const member of node.members) {
				if (member.kind === "JS_SPREAD") {
					const spread = optionStates(
						member.argument,
						model,
						option,
						new Set(seen),
						stringReasons,
					);
					// A spread replaces the previous value only on alternatives where
					// the property is present. An empty/unknown spread cannot clear it.
					states =
						(spread & optionAbsent ? states : 0) | (spread & ~optionAbsent);
				} else if (
					"name" in member &&
					staticMemberName(member.name) === option
				) {
					const value =
						member.kind === "JS_PROPERTY_OBJECT_MEMBER"
							? member.value
							: member.kind === "JS_SHORTHAND_PROPERTY_OBJECT_MEMBER"
								? member.name
								: undefined;
					states =
						option !== "retry" &&
						definitelyFalsy(value, model, new Set(), stringReasons)
							? optionDisabled
							: optionEnabled;
				}
			}
			return states;
		}
		default:
			return optionAbsent;
	}
}

function hasOption(
	node: AnyJsAstNode | undefined,
	model: SemanticModel,
	option = "retry",
	source?: string,
): boolean {
	return (
		(optionStates(
			node,
			model,
			option,
			new Set(),
			source === "node:test" && ["skip", "todo"].includes(option),
		) &
			optionEnabled) !==
		0
	);
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

function registrationOptions(
	node: AnyJsAstNode,
	api: Api,
): readonly AnyJsAstNode[] {
	const args =
		node.kind === "JS_CALL_EXPRESSION" ? (node.arguments?.args ?? []) : [];
	if (api.source === "node:test") return api.members.length === 0 ? args : [];
	return ["vitest", "@effect/vitest", "global"].includes(api.source) &&
		!api.pendingFactory
		? args.slice(1, 3)
		: [];
}

export const noTodoTests = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node, context) {
		const api = resolveApi(node.callee, context.model);
		const args = node.arguments?.args ?? [];
		if (
			api &&
			["it", "test", "describe", "suite"].includes(api.name) &&
			(api.members.includes("todo") ||
				registrationOptions(node, api).some((arg) =>
					hasOption(arg, context.model, "todo", api.source),
				) ||
				(api.source === "node:test" && api.members.length === 0
					? !potentialCallback(args.at(-1), context.model)
					: ["vitest", "@effect/vitest", "global"].includes(api.source)
						? !api.pendingFactory &&
							!args
								.slice(1, 3)
								.some((arg) => potentialCallback(arg, context.model))
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
		if (!api || !["it", "test", "describe", "suite"].includes(api.name)) return;
		for (const argument of registrationOptions(node, api)) {
			if (
				["skip", "only"].some((flag) =>
					hasOption(argument, context.model, flag, api.source),
				)
			)
				registerDiagnostic(
					argument,
					"error",
					"Do not focus or disable tests through registration options.",
				);
		}
		if (!api.members.some((member) => ["only", "skip"].includes(member)))
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
		if (!binding) return !["undefined", "NaN", "Infinity"].includes(node.text);
		const declaration = binding.syntax();
		const key = `${declaration.text}:${binding.scope().syntax().text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		if (declaration.parent?.kind === "JS_VARIABLE_DECLARATOR") {
			const value = variableValueAt(node, model);
			if (value || binding.allWrites().length === 0)
				return potentialCallback(value, model, seen);
		}
	}
	if (node.kind === "JS_TEMPLATE_EXPRESSION") return !!node.tag;
	// Unknown imported/parameter bindings may be legitimate handlers. Reject
	// provably non-callable values without inventing cross-module type inference.
	return ![
		"JS_NULL_LITERAL_EXPRESSION",
		"JS_BOOLEAN_LITERAL_EXPRESSION",
		"JS_NUMBER_LITERAL_EXPRESSION",
		"JS_STRING_LITERAL_EXPRESSION",
		"JS_BIGINT_LITERAL_EXPRESSION",
		"JS_REGEX_LITERAL_EXPRESSION",
		"JS_UNARY_EXPRESSION",
		"JS_BINARY_EXPRESSION",
		"JS_PRE_UPDATE_EXPRESSION",
		"JS_POST_UPDATE_EXPRESSION",
		"JS_OBJECT_EXPRESSION",
		"JS_ARRAY_EXPRESSION",
	].includes(node.kind);
}

function isFirstArgument(call: AnyJsAstNode, value: AnyJsAstNode): boolean {
	if (call.kind !== "JS_CALL_EXPRESSION") return false;
	const args = call.arguments?.args ?? [];
	const matches = (argument: AnyJsAstNode) =>
		argument.kind === value.kind && argument.text === value.text;
	// Fresh equal call/array operands cannot be distinguished by native handle
	// identity. An ambiguous match must not bless a separate ignored argument.
	return (
		!!args[0] &&
		matches(args[0]) &&
		(value.kind === "JS_IDENTIFIER_EXPRESSION" ||
			args.filter(matches).length === 1)
	);
}

function isPromiseAggregate(node: AnyJsAstNode, model: SemanticModel): boolean {
	if (node.kind !== "JS_CALL_EXPRESSION") return false;
	const callee = node.callee;
	return (
		callee?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
		callee.object?.kind === "JS_IDENTIFIER_EXPRESSION" &&
		callee.object.text === "Promise" &&
		!!callee.object.name &&
		!model.binding(callee.object.name) &&
		["all", "allSettled", "race", "any"].includes(callee.member?.text ?? "")
	);
}

function callbackResultHandled(
	node: AnyJsAstNode,
	model: SemanticModel,
	seen: Set<string>,
	allowVoid: boolean,
): boolean {
	const parent = node.parent;
	if (
		parent?.kind === "JS_UNARY_EXPRESSION" &&
		["typeof", "void"].includes(parent.operatorToken ?? "")
	)
		return true;
	if (
		parent?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
		parent.object?.text === node.text
	) {
		const invocation = parent.parent;
		if (
			["call", "apply"].includes(parent.member?.text ?? "") &&
			invocation?.kind === "JS_CALL_EXPRESSION"
		)
			return handled(invocation, model, seen, allowVoid);
		if (
			parent.member?.text === "bind" &&
			invocation?.kind === "JS_CALL_EXPRESSION"
		) {
			// Binding creates a function, not an assertion promise. An unused bound
			// value is inert; otherwise inspect its existing local consumers.
			return (
				invocation.parent?.kind === "JS_EXPRESSION_STATEMENT" ||
				callbackResultHandled(invocation, model, seen, allowVoid)
			);
		}
		return true;
	}
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
		return binding.allReads().every((read) => {
			const expression = read.syntax().parent;
			return (
				expression?.kind !== "JS_IDENTIFIER_EXPRESSION" ||
				callbackResultHandled(expression, model, new Set(seen), allowVoid)
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
		api.members.length === 0 &&
		((api.source === "node:test" &&
			["before", "after", "beforeEach", "afterEach"].includes(api.name)) ||
			(["vitest", "@effect/vitest"].includes(api.source) &&
				["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(
					api.name,
				)))
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
			isPromiseAggregate(aggregate, model) &&
			isFirstArgument(aggregate, call) &&
			handled(aggregate, model, seen, allowVoid)
		);
	}
	return false;
}

function readsValue(
	read: AnyJsAstNode,
	value: AnyJsAstNode,
	model: SemanticModel,
) {
	const selected = variableValueAt(read, model);
	// Equal call text can create distinct promises in an initializer and a later
	// assignment. Compare the producing parent as well as the selected expression.
	return (
		selected?.kind === value.kind &&
		selected.text === value.text &&
		selected.parent?.kind === value.parent?.kind &&
		selected.parent?.text === value.parent?.text
	);
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
		case "JS_LOGICAL_EXPRESSION":
			return (
				((parent.right?.kind === node.kind &&
					parent.right.text === node.text &&
					// Native handles expose neither offsets nor stable identity. Equal
					// call operands are ambiguous; never bless a discarded left promise.
					(parent.left?.text !== parent.right.text ||
						node.kind === "JS_IDENTIFIER_EXPRESSION")) ||
					parent.operatorToken === "||" ||
					parent.operatorToken === "??") &&
				handled(parent, model, seen, allowVoid)
			);
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
					readsValue(expression, node, model) &&
					handled(expression, model, new Set(seen), allowVoid)
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
					readsValue(expression, node, model) &&
					handled(expression, model, new Set(seen), allowVoid)
				);
			});
		}
		case "JS_ARRAY_ELEMENT_LIST":
		case "JS_ARRAY_EXPRESSION":
		case "JS_CALL_ARGUMENT_LIST":
		case "JS_CALL_ARGUMENTS": {
			let call: AnyJsAstNode | undefined = parent;
			let child = node;
			let argument: AnyJsAstNode | undefined;
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
				if (call.kind === "JS_CALL_ARGUMENT_LIST") argument = child;
				child = call;
				call = call.parent;
			}
			if (
				arrays === 0 &&
				call?.kind === "JS_CALL_EXPRESSION" &&
				!!argument &&
				isFirstArgument(call, argument) &&
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
				!!argument &&
				isFirstArgument(call, argument) &&
				isPromiseAggregate(call, model) &&
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
