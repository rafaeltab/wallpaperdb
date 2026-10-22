import assert from "node:assert/strict";
import { test } from "node:test";
import { syntaxTree, visitSyntax } from "../src/syntax.js";
import validExpect from "../src/ported/valid-expect.js";
import validExpectInPromise from "../src/ported/valid-expect-in-promise.js";
import requireAwaitedExpectPoll from "../src/ported/require-awaited-expect-poll.js";
import noRetries from "../src/retry.js";

// Finite input records for the syntax adapter's existing boundary. These do not
// parse source or implement Biome's semantic model. CLI tests own that integration.
const identifier = (name) => ({
	kind: "JS_IDENTIFIER_EXPRESSION",
	text: name,
	name: { kind: "JS_REFERENCE_IDENTIFIER", text: name },
});
const literal = (value) => ({
	kind:
		typeof value === "string"
			? "JS_STRING_LITERAL_EXPRESSION"
			: "JS_NUMBER_LITERAL_EXPRESSION",
	text: JSON.stringify(value),
});
const member = (object, name) => ({
	kind: "JS_STATIC_MEMBER_EXPRESSION",
	text: `${object.text}.${name}`,
	object,
	member: { kind: "JS_NAME", text: name },
});
const call = (callee, args = []) => ({
	kind: "JS_CALL_EXPRESSION",
	text: `${callee.text}(${args.map((arg) => arg.text).join(",")})`,
	callee,
	arguments: { args },
});
const statement = (expression) => ({
	kind: "JS_EXPRESSION_STATEMENT",
	text: `${expression.text};`,
	expression,
});
const awaited = (argument) => ({
	kind: "JS_AWAIT_EXPRESSION",
	text: `await ${argument.text}`,
	argument,
});
const returned = (argument) => ({
	kind: "JS_RETURN_STATEMENT",
	text: `return ${argument.text};`,
	argument,
});
const block = (statements) => ({
	kind: "JS_FUNCTION_BODY",
	text: `{${statements.map((node) => node.text).join("\n")}}`,
	statements,
});
const arrow = (body) => ({
	kind: "JS_ARROW_FUNCTION_EXPRESSION",
	text: `()=>${body.text}`,
	body,
});
const property = (name, value) => ({
	kind: "JS_PROPERTY_OBJECT_MEMBER",
	text: `${name}:${value.text}`,
	name: { kind: "JS_LITERAL_MEMBER_NAME", text: name },
	value,
});
const object = (members) => ({
	kind: "JS_OBJECT_EXPRESSION",
	text: `{${members.map((node) => node.text).join(",")}}`,
	members,
});
const assertion = (modifiers = [], args = [literal(1)]) => {
	let expression = call(identifier("expect"), args);
	for (const modifier of modifiers) expression = member(expression, modifier);
	return call(member(expression, "toBe"), [literal(1)]);
};
const registration = (body) =>
	call(identifier("test"), [literal("case"), arrow(block(body))]);

function diagnose(rule, statements) {
	const tree = syntaxTree({
		kind: "JS_MODULE",
		text: statements.map((node) => node.text).join("\n"),
		items: statements,
	});
	const nodes = [];
	visitSyntax(
		tree,
		new Proxy(
			{},
			{
				get: (_, key) =>
					key.endsWith(":exit") ? undefined : (node) => nodes.push(node),
			},
		),
	);
	const reports = [];
	const context = {
		// These contracts use unbound Vitest globals. Binding/import and native
		// scope correctness remain covered by actual CLI fixtures.
		model: { scope: () => null, binding: () => null },
		nodes,
		settings: { vitest: {} },
		report: (report) => reports.push(report.messageId),
	};
	const options =
		rule === validExpect
			? [{ ...rule.meta.defaultOptions[0], maxArgs: 2 }]
			: (rule.meta.defaultOptions ?? []);
	visitSyntax(tree, rule.create(context, options));
	return reports;
}

test("assertion algorithm distinguishes missing, uncalled and invalid matchers", () => {
	assert.deepEqual(
		diagnose(validExpect, [
			statement(call(identifier("expect"), [literal(1)])),
		]),
		["matcherNotFound"],
	);
	assert.deepEqual(
		diagnose(validExpect, [
			statement(member(call(identifier("expect"), [literal(1)]), "toBe")),
		]),
		["matcherNotCalled"],
	);
	assert.deepEqual(
		diagnose(validExpect, [statement(assertion(["not", "not"]))]),
		["modifierUnknown"],
	);
	assert.deepEqual(diagnose(validExpect, [statement(assertion(["not"]))]), []);
});

test("assertion argument limits retain the configured two-argument contract", () => {
	assert.deepEqual(diagnose(validExpect, [statement(assertion([], []))]), [
		"notEnoughArgs",
	]);
	assert.deepEqual(
		diagnose(validExpect, [
			statement(assertion([], [literal(1), literal("reason")])),
		]),
		[],
	);
	assert.deepEqual(
		diagnose(validExpect, [
			statement(assertion([], [literal(1), literal(2), literal(3)])),
		]),
		["tooManyArgs"],
	);
});

test("async assertion algorithm preserves await and return handling", () => {
	assert.deepEqual(
		diagnose(validExpect, [statement(assertion(["resolves"]))]),
		["asyncMustBeAwaited"],
	);
	assert.deepEqual(
		diagnose(validExpect, [statement(awaited(assertion(["resolves"])))]),
		[],
	);
	assert.deepEqual(
		diagnose(validExpect, [
			statement(registration([returned(assertion(["rejects"]))])),
		]),
		[],
	);
	assert.deepEqual(diagnose(validExpect, [statement(assertion())]), []);
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
	assert.deepEqual(diagnose(requireAwaitedExpectPoll, [statement(poll())]), [
		"notAwaited",
	]);
	assert.deepEqual(diagnose(requireAwaitedExpectPoll, [statement(element())]), [
		"notAwaited",
	]);
	assert.deepEqual(
		diagnose(requireAwaitedExpectPoll, [statement(awaited(poll()))]),
		[],
	);
	assert.deepEqual(
		diagnose(requireAwaitedExpectPoll, [
			statement(registration([returned(element())])),
		]),
		[],
	);
	assert.deepEqual(
		diagnose(requireAwaitedExpectPoll, [statement(assertion())]),
		[],
	);
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
	assert.deepEqual(
		diagnose(validExpectInPromise, [
			statement(registration([statement(chain())])),
		]),
		["expectInFloatingPromise"],
	);
	assert.deepEqual(
		diagnose(validExpectInPromise, [
			statement(registration([statement(awaited(chain()))])),
		]),
		[],
	);
	assert.deepEqual(
		diagnose(validExpectInPromise, [
			statement(registration([returned(chain())])),
		]),
		[],
	);
	assert.deepEqual(diagnose(validExpectInPromise, [statement(chain())]), []);
});

test("promise algorithm keeps ordinary promise work and helper contracts valid", () => {
	const chain = call(
		member(
			call(member(identifier("Promise"), "resolve"), [literal(1)]),
			"then",
		),
		[arrow(literal(2))],
	);
	assert.deepEqual(
		diagnose(validExpectInPromise, [
			statement(registration([statement(chain)])),
		]),
		[],
	);
	const helper = arrow(
		block([
			statement(call(member(identifier("work"), "then"), [arrow(assertion())])),
		]),
	);
	assert.deepEqual(
		diagnose(validExpectInPromise, [
			statement(
				registration([statement(call(identifier("useHelper"), [helper]))]),
			),
		]),
		[],
	);
});

test("retry algorithm rejects registration overrides while accepting application options", () => {
	const options = () => object([property("retry", literal(3))]);
	assert.deepEqual(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [
					literal("case"),
					options(),
					arrow(block([])),
				]),
			),
		]),
		["retry"],
	);
	assert.deepEqual(
		diagnose(noRetries, [
			statement(call(identifier("request"), [literal("case"), options()])),
		]),
		[],
	);
	assert.deepEqual(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [
					literal("case"),
					object([property("timeout", literal(3))]),
					arrow(block([])),
				]),
			),
		]),
		[],
	);
});

test("retry algorithm follows literal spreads without applying flag-value semantics", () => {
	const options = object([
		{
			kind: "JS_SPREAD",
			text: "...{retry:0}",
			argument: object([property("retry", literal(0))]),
		},
	]);
	assert.deepEqual(
		diagnose(noRetries, [
			statement(
				call(identifier("test"), [literal("case"), options, arrow(block([]))]),
			),
		]),
		["retry"],
	);
});
