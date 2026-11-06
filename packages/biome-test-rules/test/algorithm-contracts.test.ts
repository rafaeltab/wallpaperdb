import type { SyntaxNode, AdaptedRule, Context } from "../src/contracts.ts";
import type { NativeNode } from "../src/native-view.ts";
interface Input {
	kind: string;
	text: string;
	[key: string]: unknown;
}
import { expect, test } from "vitest";
import { syntaxTree, visitSyntax } from "../src/syntax.ts";
import validExpect from "../src/ported/valid-expect.ts";
import validExpectInPromise from "../src/ported/valid-expect-in-promise.ts";
import requireAwaitedExpectPoll from "../src/ported/require-awaited-expect-poll.ts";
import noRetries from "../src/retry.ts";

// Finite input records for the syntax adapter's existing boundary. These do not
// parse source or implement Biome's semantic model. CLI tests own that integration.
const identifier = (name: string) => ({
	kind: "JS_IDENTIFIER_EXPRESSION",
	text: name,
	name: { kind: "JS_REFERENCE_IDENTIFIER", text: name },
});
const literal = (value: string | number) => ({
	kind:
		typeof value === "string"
			? "JS_STRING_LITERAL_EXPRESSION"
			: "JS_NUMBER_LITERAL_EXPRESSION",
	text: JSON.stringify(value),
});
const member = (object: Input, name: string) => ({
	kind: "JS_STATIC_MEMBER_EXPRESSION",
	text: `${object.text}.${name}`,
	object,
	member: { kind: "JS_NAME", text: name },
});
const call = (callee: Input, args: Input[] = []) => ({
	kind: "JS_CALL_EXPRESSION",
	text: `${callee.text}(${args.map((arg) => arg.text).join(",")})`,
	callee,
	arguments: { args },
});
const statement = (expression: Input) => ({
	kind: "JS_EXPRESSION_STATEMENT",
	text: `${expression.text};`,
	expression,
});
const awaited = (argument: Input) => ({
	kind: "JS_AWAIT_EXPRESSION",
	text: `await ${argument.text}`,
	argument,
});
const returned = (argument: Input) => ({
	kind: "JS_RETURN_STATEMENT",
	text: `return ${argument.text};`,
	argument,
});
const block = (statements: Input[]) => ({
	kind: "JS_FUNCTION_BODY",
	text: `{${statements.map((node) => node.text).join("\n")}}`,
	statements,
});
const arrow = (body: Input) => ({
	kind: "JS_ARROW_FUNCTION_EXPRESSION",
	text: `()=>${body.text}`,
	body,
});
const property = (name: string, value: Input) => ({
	kind: "JS_PROPERTY_OBJECT_MEMBER",
	text: `${name}:${value.text}`,
	name: { kind: "JS_LITERAL_MEMBER_NAME", text: name },
	value,
});
const object = (members: Input[]) => ({
	kind: "JS_OBJECT_EXPRESSION",
	text: `{${members.map((node) => node.text).join(",")}}`,
	members,
});
const assertion = (modifiers: string[] = [], args = [literal(1)]) => {
	let expression: Input = call(identifier("expect"), args);
	for (const modifier of modifiers) expression = member(expression, modifier);
	return call(member(expression, "toBe"), [literal(1)]);
};
const registration = (body: Input[]) =>
	call(identifier("test"), [literal("case"), arrow(block(body))]);

test("retry keys decode escaped spellings without rejecting unrelated keys", () => {
	for (const [key, expected] of [
		[String.raw`"re\u0074ry"`, ["retry"]],
		[String.raw`"re\u{74}\x72y"`, ["retry"]],
		['"re\\\ntry"', ["retry"]],
		[String.raw`"re\ttry"`, []],
	] as const) {
		expect(
			diagnose(noRetries, [
				statement(
					call(identifier("test"), [
						literal("case"),
						object([property(key, literal(3))]),
						arrow(block([])),
					]),
				),
			]),
			key,
		).toStrictEqual(expected);
	}
});

function diagnose(rule: AdaptedRule, statements: Input[]) {
	const tree = syntaxTree({
		kind: "JS_MODULE",
		text: statements.map((node) => node.text).join("\n"),
		items: statements,
	} as unknown as NativeNode);
	const nodes: SyntaxNode[] = [];
	visitSyntax(
		tree,
		new Proxy(
			{},
			{
				get: (_, key) =>
					String(key).endsWith(":exit")
						? undefined
						: (node: SyntaxNode) => nodes.push(node),
			},
		),
	);
	const reports: string[] = [];
	const context: Context = {
		// These contracts use unbound Vitest globals. Binding/import and native
		// scope correctness remain covered by actual CLI fixtures.
		model: { scope: () => undefined, binding: () => undefined },
		nodes,
		settings: { vitest: {} },
		report: (report) => reports.push(report.messageId),
	};
	const options =
		rule === validExpect
			? [{ ...rule.meta.defaultOptions![0], maxArgs: 2 }]
			: (rule.meta.defaultOptions ?? []);
	visitSyntax(tree, rule.create(context, options));
	return reports;
}

test("syntax locations retain UTF-16 columns and LF-only line boundaries", () => {
	const tree = syntaxTree({
		kind: "JS_MODULE",
		text: "\ufeff/*😀*/one;\r\n\n  two;\r\u2028one;",
		items: ["one", "two", "one"].map((name) => statement(identifier(name))),
	} as unknown as NativeNode);
	expect(tree.loc).toStrictEqual({
		start: { line: 1, column: 0 },
		end: { line: 3, column: 12 },
	});
	expect((tree.body as SyntaxNode[]).map((node) => node.loc)).toStrictEqual([
		{ start: { line: 1, column: 7 }, end: { line: 1, column: 11 } },
		{ start: { line: 3, column: 2 }, end: { line: 3, column: 6 } },
		{ start: { line: 3, column: 8 }, end: { line: 3, column: 12 } },
	]);
	expect(
		(tree.body as SyntaxNode[]).map((node) => node.expression.loc),
	).toStrictEqual([
		{ start: { line: 1, column: 7 }, end: { line: 1, column: 10 } },
		{ start: { line: 3, column: 2 }, end: { line: 3, column: 5 } },
		{ start: { line: 3, column: 8 }, end: { line: 3, column: 11 } },
	]);
	for (const [text, end] of [
		["", { line: 1, column: 0 }],
		["one;\n", { line: 2, column: 0 }],
		["one;\r\n\n", { line: 3, column: 0 }],
	] as const) {
		expect(
			syntaxTree({
				kind: "JS_MODULE",
				text,
				items: [],
			} as unknown as NativeNode).loc,
		).toStrictEqual({
			start: { line: 1, column: 0 },
			end,
		});
	}
});

test("assertion algorithm distinguishes missing, uncalled and invalid matchers", () => {
	expect(
		diagnose(validExpect, [
			statement(call(identifier("expect"), [literal(1)])),
		]),
	).toStrictEqual(["matcherNotFound"]);
	expect(
		diagnose(validExpect, [
			statement(member(call(identifier("expect"), [literal(1)]), "toBe")),
		]),
	).toStrictEqual(["matcherNotCalled"]);
	expect(
		diagnose(validExpect, [statement(assertion(["not", "not"]))]),
	).toStrictEqual(["modifierUnknown"]);
	expect(diagnose(validExpect, [statement(assertion(["not"]))])).toStrictEqual(
		[],
	);
});

test("assertion argument limits retain the configured two-argument contract", () => {
	expect(diagnose(validExpect, [statement(assertion([], []))])).toStrictEqual([
		"notEnoughArgs",
	]);
	expect(
		diagnose(validExpect, [
			statement(assertion([], [literal(1), literal("reason")])),
		]),
	).toStrictEqual([]);
	expect(
		diagnose(validExpect, [
			statement(assertion([], [literal(1), literal(2), literal(3)])),
		]),
	).toStrictEqual(["tooManyArgs"]);
});

test("async assertion algorithm preserves await and return handling", () => {
	expect(
		diagnose(validExpect, [statement(assertion(["resolves"]))]),
	).toStrictEqual(["asyncMustBeAwaited"]);
	expect(
		diagnose(validExpect, [statement(awaited(assertion(["resolves"])))]),
	).toStrictEqual([]);
	expect(
		diagnose(validExpect, [
			statement(registration([returned(assertion(["rejects"]))])),
		]),
	).toStrictEqual([]);
	expect(diagnose(validExpect, [statement(assertion())])).toStrictEqual([]);
});

test("poll algorithm rejects floating poll and element assertions, accepting await and return", () => {
	const poll = () =>
		call(
			member(
				call(member(identifier("expect"), "poll"), [arrow(literal(1))]),
				"toBe",
			),
			[literal(1)],
		);
	const element = () =>
		call(
			member(
				call(member(identifier("expect"), "element"), [identifier("button")]),
				"toBeVisible",
			),
		);
	expect(diagnose(requireAwaitedExpectPoll, [statement(poll())])).toStrictEqual(
		["notAwaited"],
	);
	expect(
		diagnose(requireAwaitedExpectPoll, [statement(element())]),
	).toStrictEqual(["notAwaited"]);
	expect(
		diagnose(requireAwaitedExpectPoll, [statement(awaited(poll()))]),
	).toStrictEqual([]);
	expect(
		diagnose(requireAwaitedExpectPoll, [
			statement(registration([returned(element())])),
		]),
	).toStrictEqual([]);
	expect(
		diagnose(requireAwaitedExpectPoll, [statement(assertion())]),
	).toStrictEqual([]);
});

test("promise algorithm reports a floating assertion chain inside a test callback", () => {
	const chain = () =>
		call(
			member(
				call(member(identifier("Promise"), "resolve"), [literal(1)]),
				"then",
			),
			[arrow(assertion())],
		);
	expect(
		diagnose(validExpectInPromise, [
			statement(registration([statement(chain())])),
		]),
	).toStrictEqual(["expectInFloatingPromise"]);
	expect(
		diagnose(validExpectInPromise, [
			statement(registration([statement(awaited(chain()))])),
		]),
	).toStrictEqual([]);
	expect(
		diagnose(validExpectInPromise, [
			statement(registration([returned(chain())])),
		]),
	).toStrictEqual([]);
	expect(diagnose(validExpectInPromise, [statement(chain())])).toStrictEqual(
		[],
	);
});

test("promise algorithm keeps ordinary promise work and helper contracts valid", () => {
	const chain = call(
		member(
			call(member(identifier("Promise"), "resolve"), [literal(1)]),
			"then",
		),
		[arrow(literal(2))],
	);
	expect(
		diagnose(validExpectInPromise, [
			statement(registration([statement(chain)])),
		]),
	).toStrictEqual([]);
	const helper = arrow(
		block([
			statement(call(member(identifier("work"), "then"), [arrow(assertion())])),
		]),
	);
	expect(
		diagnose(validExpectInPromise, [
			statement(
				registration([statement(call(identifier("useHelper"), [helper]))]),
			),
		]),
	).toStrictEqual([]);
});

test("promise algorithm tracks whether an assigned assertion promise is consumed", () => {
	const chain = call(member(identifier("work"), "then"), [arrow(assertion())]);
	const declaration: Input = {
		kind: "JS_VARIABLE_DECLARATION",
		text: `const pending=${chain.text};`,
		declarators: [
			{
				kind: "JS_VARIABLE_DECLARATOR",
				text: `pending=${chain.text}`,
				id: { kind: "JS_IDENTIFIER_BINDING", text: "pending" },
				initializer: { expression: chain },
			},
		],
	};
	for (const [consumption, expected] of [
		[[], ["expectInFloatingPromise"]],
		[[statement(awaited(identifier("pending")))], []],
		[[returned(identifier("pending"))], []],
		[
			[
				returned(
					call(member(identifier("Promise"), "resolve"), [
						identifier("pending"),
					]),
				),
			],
			[],
		],
		[[returned(identifier("unrelated"))], ["expectInFloatingPromise"]],
		...(
			[
				["pending", []],
				["unrelated", ["expectInFloatingPromise"]],
			] as const
		).map(
			([name, expected]) =>
				[
					[
						returned(
							call(member(identifier("Promise"), "all"), [
								{
									kind: "JS_ARRAY_EXPRESSION",
									text: `[${name}]`,
									elements: [identifier(name)],
								},
							]),
						),
					],
					expected,
				] as const,
		),
	] as const) {
		expect(
			diagnose(validExpectInPromise, [
				statement(registration([declaration, ...consumption])),
			]),
		).toStrictEqual(expected);
	}
});

test("retry algorithm rejects registration overrides while accepting application options", () => {
	const options = () => object([property("retry", literal(3))]);
	expect(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [
					literal("case"),
					options(),
					arrow(block([])),
				]),
			),
		]),
	).toStrictEqual(["retry"]);
	expect(
		diagnose(noRetries, [
			statement(call(identifier("request"), [literal("case"), options()])),
		]),
	).toStrictEqual([]);
	expect(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [
					literal("case"),
					object([property("timeout", literal(3))]),
					arrow(block([])),
				]),
			),
		]),
	).toStrictEqual([]);
});

test("retry algorithm follows literal spreads without applying flag-value semantics", () => {
	const options = object([
		{
			kind: "JS_SPREAD",
			text: "...{retry:0}",
			argument: object([property("retry", literal(0))]),
		},
	]);
	expect(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [literal("case"), options, arrow(block([]))]),
			),
		]),
	).toStrictEqual(["retry"]);
});
