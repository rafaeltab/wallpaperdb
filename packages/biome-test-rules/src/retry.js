// Translated from #437 at 7cfe7fc1, scripts/eslint-rules/no-test-retries.mjs.
// The configured traversal follows declaration initializers, not assignments.
import { definition } from "./scope.js";

const registrations = new Set(["it", "test", "describe", "suite"]);
export default {
	name: "test-policy/no-retries",
	meta: {
		messages: {
			retry:
				"Use the shared retry policy. Repair failing tests instead of overriding retries.",
		},
	},
	create(context) {
		const reported = new WeakSet();
		function isRegistration(callee, seen = new Set(), members = []) {
			if (seen.has(callee)) return false;
			seen.add(callee);
			while (
				[
					"CallExpression",
					"MemberExpression",
					"TaggedTemplateExpression",
				].includes(callee.type)
			) {
				if (callee.type === "CallExpression") callee = callee.callee;
				else if (callee.type === "TaggedTemplateExpression")
					callee = callee.tag;
				else {
					members.push(
						callee.computed ? callee.property.value : callee.property.name,
					);
					callee = callee.object;
				}
			}
			if (callee.type !== "Identifier") return false;
			const binding = definition(context, callee);
			if (!binding) return registrations.has(callee.name);
			if (binding.type === "Variable" && binding.node.init)
				return isRegistration(binding.node.init, seen, members);
			if (
				binding.type !== "ImportBinding" ||
				binding.parent.source.value !== "vitest"
			)
				return false;
			return binding.node.type === "ImportNamespaceSpecifier"
				? registrations.has(members.at(-1))
				: registrations.has(
						binding.node.imported.name ?? binding.node.imported.value,
					);
		}
		function inspectOptions(node, seen = new Set()) {
			if (seen.has(node)) return;
			seen.add(node);
			if (node.type === "Identifier") {
				const binding = definition(context, node);
				if (binding?.type === "Variable" && binding.node.init)
					inspectOptions(binding.node.init, seen);
			} else if (node.type === "ObjectExpression") {
				for (const property of node.properties) {
					if (property.type === "SpreadElement")
						inspectOptions(property.argument, seen);
					else if (
						(property.computed
							? property.key.value
							: (property.key.name ?? property.key.value)) === "retry" &&
						!reported.has(property)
					) {
						reported.add(property);
						context.report({ node: property, messageId: "retry" });
					}
				}
			}
		}
		return {
			CallExpression(node) {
				if (node.arguments.length < 2 || !isRegistration(node.callee)) return;
				for (const argument of node.arguments.slice(1))
					inspectOptions(argument);
			},
		};
	},
};
