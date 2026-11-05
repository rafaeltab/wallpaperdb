import type { SyntaxNode, AdaptedRule } from "./contracts.ts";
import {
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";
import { nativeView } from "./native-view.ts";
import type { AnyJsAstNode } from "@biomejs/runtime/plugin";
import { syntaxTree, visitSyntax } from "./syntax.ts";

export function port(
	rule: AdaptedRule,
	options = rule.meta.defaultOptions ?? [],
) {
	return defineRule({
		query: semantic("JS_MODULE", "JS_SCRIPT"),
		run(root, context) {
			const tree = syntaxTree(nativeView(root));
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
							(_: string, key: string) => String(data[key] ?? ""),
						);
						registerDiagnostic(
							node.native as unknown as AnyJsAstNode,
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
