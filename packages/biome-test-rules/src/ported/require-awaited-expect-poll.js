// Adapted from @vitest/eslint-plugin 1.6.27, commit aad57d121647efe764463c37414a8cd67ec9cf92.
// MIT; see ../../UPSTREAM-LICENSE.txt. Biome supplies syntax/scope and diagnostics.
import { AST_NODE_TYPES } from "./utils.js";
import { createEslintRule, getAccessorValue } from "./utils.js";
import { parseVitestFnCall } from "./parse-vitest-fn-call.js";
const RULE_NAME = "require-awaited-expect-poll";
export default createEslintRule({
	name: RULE_NAME,
	meta: {
		docs: {
			requiresTypeChecking: false,
			recommended: false,
			description: "ensure that every `expect.poll` call is awaited",
		},
		messages: {
			notAwaited: "`{{ method }}` calls should be awaited",
		},
		type: "problem",
		schema: [],
	},
	create(context) {
		const reported = new Set();
		return {
			CallExpression(node) {
				const vitestFnCall = parseVitestFnCall(node, context);
				if (
					vitestFnCall?.type !== "expect" ||
					!vitestFnCall.members.length ||
					!memberRequiresAwait(vitestFnCall.members[0])
				) {
					return;
				}
				const nodeToReport = vitestFnCall.members[0].parent;
				if (reported.has(nodeToReport)) {
					return;
				}
				const topMostNode = skipSequenceExpressions(
					skipMatchersAndModifiers(vitestFnCall.head.node),
				);
				const isHandled =
					topMostNode.parent?.type === AST_NODE_TYPES.AwaitExpression ||
					topMostNode.parent?.type === AST_NODE_TYPES.ReturnStatement;
				if (isHandled) {
					return;
				}
				context.report({
					node: nodeToReport,
					messageId: "notAwaited",
					data: {
						method: `expect.${getAccessorValue(vitestFnCall.members[0])}`,
					},
				});
				reported.add(nodeToReport);
			},
		};
	},
});
const awaitedMembers = ["poll", "element"];
function memberRequiresAwait(member) {
	return awaitedMembers.includes(getAccessorValue(member));
}
function skipMatchersAndModifiers(node) {
	let currentNode = node;
	while (
		currentNode.parent.type === AST_NODE_TYPES.MemberExpression ||
		currentNode.parent.type === AST_NODE_TYPES.CallExpression
	) {
		currentNode = currentNode.parent;
	}
	return currentNode;
}
function skipSequenceExpressions(node) {
	let currentNode = node;
	while (
		currentNode.parent?.type === AST_NODE_TYPES.SequenceExpression &&
		currentNode.parent.expressions.at(-1) === currentNode
	) {
		currentNode = currentNode.parent;
	}
	return currentNode;
}
