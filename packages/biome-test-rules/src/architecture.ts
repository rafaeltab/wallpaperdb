import {
	ast,
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";

// Queries visit only relevant native nodes. No source copying, filesystem IO,
// dependency resolution, or whole-tree traversal occurs in these rules.
const runners =
	/^(?:run(?:Promise|Sync|Fork|Callback)(?:Exit)?|make|makeWith|defaultRuntime)$/;
export const capabilityExecution = defineRule({
	query: semantic("JS_REFERENCE_IDENTIFIER"),
	run(node, context) {
		const binding = context.model.binding(node);
		if (!binding && node.text.trim() === "process") {
			registerDiagnostic(
				node,
				"error",
				"capability-configuration: pass parsed configuration inward from composition.",
			);
			return;
		}
		const declaration = binding?.syntax();
		const ancestors = declaration?.ancestors() ?? [];
		const imported = ancestors.find((n) => n.kind === "JS_IMPORT");
		if (!imported) return;
		const clause = imported.importClause;
		const source = clause?.source?.valueToken?.slice(1, -1);
		if (
			!source ||
			!/^effect(?:\/(?:Effect|Runtime|ManagedRuntime))?$/.test(source)
		)
			return;
		const specifier = declaration?.parent;
		const original =
			specifier?.kind === "JS_NAMED_IMPORT_SPECIFIER"
				? specifier.name?.text.trim()
				: declaration?.text.trim();
		const parent = node.parent;
		const member =
			parent?.kind === "JS_IDENTIFIER_EXPRESSION" ? parent.parent : undefined;
		const property =
			member?.kind === "JS_STATIC_MEMBER_EXPRESSION"
				? member.member?.text.trim()
				: member?.kind === "JS_COMPUTED_MEMBER_EXPRESSION"
					? member.member?.text.trim().replace(/^['"]|['"]$/g, "")
					: undefined;
		if (
			(source !== "effect" && original && runners.test(original)) ||
			(property &&
				runners.test(property) &&
				(source !== "effect" ||
					/^(Effect|Runtime|ManagedRuntime)$/.test(original ?? "")))
		) {
			registerDiagnostic(
				node,
				"error",
				"capability-execution: execute effects at a driving adapter or composition root.",
			);
		}
	},
});
export const capabilityEntry = defineRule({
	query: ast("JS_MODULE", "JS_SCRIPT"),
	run(node, context) {
		if (!/\/capabilities\/[^/]+\/index\.ts$/.test(context.filePath)) return;
		const statements = node.kind === "JS_MODULE" ? node.items : node.statements;
		for (const statement of statements) {
			if (statement.kind === "JS_IMPORT") continue;
			if (
				statement.kind === "JS_EXPORT" &&
				["JS_EXPORT_NAMED_FROM_CLAUSE", "JS_EXPORT_NAMED_CLAUSE"].includes(
					statement.exportClause?.kind ?? "",
				)
			)
				continue;
			registerDiagnostic(
				statement,
				"error",
				"capability-entry: use explicit named exports of imported contracts; declare contracts in contract.ts and behavior in private implementation files.",
			);
		}
	},
});
