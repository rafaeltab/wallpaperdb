import {
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";
import { syntaxTree, visitSyntax } from "./syntax.js";

export function port(rule, options = rule.meta.defaultOptions ?? []) {
	return defineRule({
		query: semantic("JS_MODULE", "JS_SCRIPT"),
		run(root, context) {
			const tree = syntaxTree(root);
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
			const visitor = rule.create(
				{
					model: context.model,
					nodes,
					settings: {
						vitest: {
							typecheck: context.sourceType.language.kind === "typescript",
						},
					},
					report({ node, messageId, data = {} }) {
						const message = rule.meta.messages[messageId].replace(
							/{{\s*(\w+)\s*}}/g,
							(_, key) => String(data[key] ?? ""),
						);
						registerDiagnostic(
							node.native,
							"error",
							`${rule.name}: ${message}`,
						);
					},
				},
				options,
			);
			visitSyntax(tree, visitor);
		},
	});
}
