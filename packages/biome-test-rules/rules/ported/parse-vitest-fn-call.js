// Adapted from @vitest/eslint-plugin 1.6.27, commit aad57d121647efe764463c37414a8cd67ec9cf92.
// MIT; see ../../UPSTREAM-LICENSE.txt. Biome supplies syntax/scope and diagnostics.
import { AST_NODE_TYPES } from "./utils.js";
import {
	DescribeAlias,
	HookName,
	ModifierName,
	TestCaseName,
} from "./types.js";
import { ValidVitestFnCallChains } from "./valid-vitest-fn-call-chains.js";
import { getAccessorValue, isSupportedAccessor } from "./utils.js";
import { getScope, resolveScope } from "../scope.js";
export const isTypeOfVitestFnCall = (node, context, types) => {
	const vitestFnCall = parseVitestFnCall(node, context);
	return vitestFnCall !== null && types.includes(vitestFnCall.type);
};
export const parseVitestFnCall = (node, context) => {
	const vitestFnCall = parseVitestFnCallWithReason(node, context);
	if (typeof vitestFnCall === "string") return null;
	return vitestFnCall;
};
const parseVitestFnCallCache = new WeakMap();
export const parseVitestFnCallWithReason = (node, context) => {
	let parsedVitestFnCall = parseVitestFnCallCache.get(node);
	if (parsedVitestFnCall) return parsedVitestFnCall;
	parsedVitestFnCall = parseVitestFnCallWithReasonInner(node, context);
	parseVitestFnCallCache.set(node, parsedVitestFnCall);
	return parsedVitestFnCall;
};
const determineVitestFnType = (name) => {
	if (name === "expect") return "expect";
	if (name === "expectTypeOf") return "expectTypeOf";
	if (name === "vi" || name === "vitest") return "vi";
	if (Object.prototype.hasOwnProperty.call(DescribeAlias, name))
		return "describe";
	if (Object.prototype.hasOwnProperty.call(TestCaseName, name)) return "test";
	if (Object.prototype.hasOwnProperty.call(HookName, name)) return "hook";
	return "unknown";
};
const hasInvalidExpectChain = (chains, matcherIndex) => {
	const modifierChains =
		matcherIndex === -1 ? chains : chains.slice(0, matcherIndex);
	if (
		modifierChains.some(
			(chain) =>
				chain.kind === "unknown" ||
				(!["expect-api", "matcher"].includes(chain.kind) &&
					chain.callExpression),
		)
	)
		return true;
	const modifierNames = modifierChains
		.filter((chain) => chain.kind === "modifier")
		.map((chain) => getAccessorValue(chain.member));
	if (modifierNames.filter((name) => name === ModifierName.not).length > 1)
		return true;
	const promiseModifierNames = modifierNames.filter((name) =>
		promiseExpectModifiers.has(name),
	);
	if (promiseModifierNames.length > 1) return true;
	return !chains
		.slice(matcherIndex + 1)
		.every(
			(chain) =>
				chain.kind !== "unknown" &&
				(chain.kind === "expect-api" ||
					chain.kind === "matcher" ||
					!chain.callExpression),
		);
};
const chaiLanguageChainProperties = new Set([
	"also",
	"and",
	"at",
	"be",
	"been",
	"but",
	"does",
	"has",
	"have",
	"is",
	"itself",
	"of",
	"same",
	"still",
	"that",
	"to",
	"which",
	"with",
]);
const chaiFlagChainProperties = new Set([
	"all",
	"any",
	"deep",
	"nested",
	"ordered",
	"own",
]);
const chaiDualRoleChainProperties = new Set([
	"a",
	"an",
	"contain",
	"contains",
	"include",
	"includes",
	"length",
	"lengthOf",
	"respondTo",
]);
const chaiChainableProperties = new Set([
	...chaiLanguageChainProperties,
	...chaiFlagChainProperties,
	...chaiDualRoleChainProperties,
]);
const expectModifiers = new Set([
	ModifierName.not,
	ModifierName.rejects,
	ModifierName.resolves,
]);
const expectApiMethods = new Set(["element", "poll", "soft"]);
const promiseExpectModifiers = new Set([
	ModifierName.rejects,
	ModifierName.resolves,
]);
const expectTypeOfModifiers = new Set([
	ModifierName.not,
	ModifierName.resolves,
	ModifierName.returns,
	ModifierName.branded,
	ModifierName.asserts,
	ModifierName.constructorParameters,
	ModifierName.parameters,
	ModifierName.thisParameter,
	ModifierName.guards,
	ModifierName.instance,
	ModifierName.items,
]);
const getCallExpression = (member) =>
	member.parent?.type === AST_NODE_TYPES.MemberExpression &&
	member.parent.parent?.type === AST_NODE_TYPES.CallExpression &&
	member.parent.parent.callee === member.parent
		? member.parent.parent
		: null;
const classifyExpectChain = (
	member,
	isFirstMemberOfStaticExpectCall = false,
) => {
	const name = getAccessorValue(member);
	const callExpression = getCallExpression(member);
	if (callExpression) {
		if (isFirstMemberOfStaticExpectCall && expectApiMethods.has(name))
			return { kind: "expect-api", member, callExpression };
		// `expect.any(...)` is a static asymmetric matcher factory, not Chai's
		// `.any` flag. Keep uncalled `.any` in Chai chains as a language chain.
		if (isFirstMemberOfStaticExpectCall && name === "any")
			return { kind: "matcher", member, callExpression };
		if (
			expectModifiers.has(name) ||
			(chaiChainableProperties.has(name) &&
				!chaiDualRoleChainProperties.has(name))
		)
			return { kind: "language-chain", member, callExpression };
		return { kind: "matcher", member, callExpression };
	}
	if (isFirstMemberOfStaticExpectCall && name === "assert")
		return { kind: "expect-api", member, callExpression };
	if (chaiChainableProperties.has(name))
		return { kind: "language-chain", member, callExpression };
	if (!expectModifiers.has(name))
		return { kind: "unknown", member, callExpression };
	return { kind: "modifier", member, callExpression };
};
const parseExpectCallExpression = (
	node,
	topMostCallExpression,
	typeLessParsedVitestFnCall,
) => {
	const chains = typeLessParsedVitestFnCall.members.map((member, index) =>
		classifyExpectChain(
			member,
			index === 0 &&
				typeLessParsedVitestFnCall.head.node.parent?.type ===
					AST_NODE_TYPES.MemberExpression,
		),
	);
	const matcherIndex = chains.findIndex((chain) => chain.kind === "matcher");
	if (
		node.parent?.type === AST_NODE_TYPES.MemberExpression &&
		topMostCallExpression !== node
	)
		return null;
	if (hasInvalidExpectChain(chains, matcherIndex)) return "modifier-unknown";
	if (matcherIndex === -1) {
		if (node.parent?.type === AST_NODE_TYPES.MemberExpression)
			return "matcher-not-called";
		return "matcher-not-found";
	}
	const modifierChains = chains.slice(0, matcherIndex);
	const matcher = chains[matcherIndex];
	const expectApi = chains.find((chain) => chain.kind === "expect-api");
	return {
		...typeLessParsedVitestFnCall,
		type: "expect",
		members: typeLessParsedVitestFnCall.members.slice(0, matcherIndex + 1),
		matcher: matcher.member,
		expectApiName: expectApi ? getAccessorValue(expectApi.member) : null,
		expectCall:
			expectApi?.callExpression ??
			(typeLessParsedVitestFnCall.head.node.parent?.type ===
			AST_NODE_TYPES.CallExpression
				? typeLessParsedVitestFnCall.head.node.parent
				: null),
		args: matcher.callExpression?.arguments ?? [],
		modifiers: modifierChains
			.filter((chain) => chain.kind === "modifier")
			.map((chain) => chain.member),
	};
};
const parseExpectTypeOfCallExpression = (
	node,
	topMostCallExpression,
	typeLessParsedVitestFnCall,
) => {
	const matcherIndex = typeLessParsedVitestFnCall.members.findIndex((member) =>
		getCallExpression(member),
	);
	const modifierMembers =
		matcherIndex === -1
			? typeLessParsedVitestFnCall.members
			: typeLessParsedVitestFnCall.members.slice(0, matcherIndex);
	const modifierNames = modifierMembers.map(getAccessorValue);
	if (
		node.parent?.type === AST_NODE_TYPES.MemberExpression &&
		topMostCallExpression !== node
	)
		return null;
	if (
		modifierMembers.some(
			(member) => !expectTypeOfModifiers.has(getAccessorValue(member)),
		) ||
		modifierNames.filter((name) => name === ModifierName.not).length > 1 ||
		(matcherIndex !== -1 &&
			expectTypeOfModifiers.has(
				getAccessorValue(typeLessParsedVitestFnCall.members[matcherIndex]),
			))
	) {
		return "modifier-unknown";
	}
	if (matcherIndex === -1) {
		if (node.parent?.type === AST_NODE_TYPES.MemberExpression)
			return "matcher-not-called";
		return "matcher-not-found";
	}
	const matcher = typeLessParsedVitestFnCall.members[matcherIndex];
	const callExpression = getCallExpression(matcher);
	if (!callExpression) return null;
	return {
		...typeLessParsedVitestFnCall,
		type: "expectTypeOf",
		matcher,
		expectApiName: null,
		expectCall:
			typeLessParsedVitestFnCall.head.node.parent?.type ===
			AST_NODE_TYPES.CallExpression
				? typeLessParsedVitestFnCall.head.node.parent
				: null,
		args: callExpression.arguments,
		modifiers: modifierMembers,
	};
};
export const findTopMostCallExpression = (node) => {
	let topMostCallExpression = node;
	let { parent } = node;
	while (parent) {
		if (parent.type === AST_NODE_TYPES.CallExpression) {
			topMostCallExpression = parent;
			parent = parent.parent;
			continue;
		}
		if (parent.type !== AST_NODE_TYPES.MemberExpression) break;
		parent = parent.parent;
	}
	return topMostCallExpression;
};
const parseVitestFnCallWithReasonInner = (node, context) => {
	const chain = getNodeChain(node);
	if (!chain?.length) return null;
	const [first, ...rest] = chain;
	const lastLink = getAccessorValue(chain[chain.length - 1]);
	if (lastLink === "each") {
		if (
			node.callee.type !== AST_NODE_TYPES.CallExpression &&
			node.callee.type !== AST_NODE_TYPES.TaggedTemplateExpression
		)
			return null;
	}
	if (
		node.callee.type === AST_NODE_TYPES.TaggedTemplateExpression &&
		lastLink !== "each"
	)
		return null;
	const resolved = resolveVitestFn(context, node, getAccessorValue(first));
	if (!resolved) return null;
	const name = resolved.original ?? resolved.local;
	const links = [name, ...rest.map(getAccessorValue)];
	if (
		resolved.type !== "testContext" &&
		name !== "vi" &&
		name !== "vitest" &&
		name !== "expect" &&
		name !== "expectTypeOf" &&
		!ValidVitestFnCallChains.has(links.join("."))
	)
		return null;
	const parsedVitestFnCall = {
		name,
		head: { ...resolved, node: first },
		members: rest,
	};
	const type = determineVitestFnType(name);
	if (type === "expect" || type === "expectTypeOf") {
		const topMostCallExpression = findTopMostCallExpression(node);
		return type === "expect"
			? parseExpectCallExpression(
					node,
					topMostCallExpression,
					parsedVitestFnCall,
				)
			: parseExpectTypeOfCallExpression(
					node,
					topMostCallExpression,
					parsedVitestFnCall,
				);
	}
	if (
		chain
			.slice(0, chain.length - 1)
			.some((node) => node.parent?.type !== AST_NODE_TYPES.MemberExpression)
	)
		return null;
	if (
		node.parent?.type === AST_NODE_TYPES.CallExpression ||
		node.parent?.type === AST_NODE_TYPES.MemberExpression
	)
		return null;
	return { ...parsedVitestFnCall, type };
};
const joinChains = (a, b) => (a && b ? [...a, ...b] : null);
export function getNodeChain(node) {
	if (isSupportedAccessor(node)) return [node];
	switch (node.type) {
		case AST_NODE_TYPES.TaggedTemplateExpression:
			return getNodeChain(node.tag);
		case AST_NODE_TYPES.MemberExpression:
			return joinChains(getNodeChain(node.object), getNodeChain(node.property));
		case AST_NODE_TYPES.CallExpression:
			return getNodeChain(node.callee);
	}
	return null;
}
const resolveVitestFn = (context, node, identifier) => {
	const scope = getScope(context, node);
	const maybeImport = resolveScope(scope, identifier);
	if (maybeImport === "local") return null;
	if (maybeImport === "testContext")
		return {
			local: identifier,
			original: null,
			type: "testContext",
		};
	if (maybeImport) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-expect-error
		const vitestImports = context.settings.vitest?.vitestImports ?? [];
		const isVitestImport =
			maybeImport.source === "vitest" ||
			vitestImports.some((importName) =>
				importName instanceof RegExp
					? importName.test(maybeImport.source)
					: maybeImport.source === importName,
			);
		if (isVitestImport) {
			return {
				original: maybeImport.imported,
				local: maybeImport.local,
				type: "import",
			};
		}
		return null;
	}
	return {
		original: resolvePossibleAliasedGlobal(identifier, context),
		local: identifier,
		type: "global",
	};
};
const resolvePossibleAliasedGlobal = (global, context) => {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	const globalAliases = context.settings.vitest?.globalAliases ?? {};
	const alias = Object.entries(globalAliases).find(([_, aliases]) =>
		aliases.includes(global),
	);
	if (alias) return alias[0];
	return null;
};
const isAncestorTestCaseCall = ({ parent }) => {
	return (
		parent?.type === AST_NODE_TYPES.CallExpression &&
		parent.callee.type === AST_NODE_TYPES.Identifier &&
		Object.prototype.hasOwnProperty.call(TestCaseName, parent.callee.name)
	);
};
