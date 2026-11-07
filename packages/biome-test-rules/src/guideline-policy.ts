import type { AnyJsAstNode, SemanticModel } from "@biomejs/runtime/plugin";
const runners =
	/^(?:run(?:Promise|Sync|Fork|Callback)(?:Exit)?(?:With)?|make|makeWith|makeRunMain|defaultRuntime)$/;
function propertyName(member: AnyJsAstNode | undefined): string | undefined {
	if (member?.kind === "JS_STATIC_MEMBER_EXPRESSION")
		return member.member?.text.trim();
	if (
		member?.kind === "JS_COMPUTED_MEMBER_EXPRESSION" &&
		member.member?.kind === "JS_STRING_LITERAL_EXPRESSION"
	)
		return member.member.valueToken?.slice(1, -1);
	return undefined;
}

export function capabilityViolation(
	node: AnyJsAstNode,
	binding: ReturnType<SemanticModel["binding"]>,
) {
	const parent = node.parent;
	const member =
		parent?.kind === "JS_IDENTIFIER_EXPRESSION" ? parent.parent : undefined;
	const property = propertyName(member);
	if (
		!binding &&
		(node.text.trim() === "process" ||
			(/^(globalThis|global)$/.test(node.text.trim()) &&
				property === "process"))
	) {
		return "capability-configuration: pass parsed configuration inward from composition.";
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
	const namespaceRunner =
		source === "effect" &&
		specifier?.kind === "JS_NAMESPACE_IMPORT_SPECIFIER" &&
		/^(Effect|Runtime|ManagedRuntime)$/.test(property ?? "")
			? propertyName(member?.parent)
			: undefined;
	if (
		(namespaceRunner && runners.test(namespaceRunner)) ||
		(source !== "effect" && original && runners.test(original)) ||
		(property &&
			runners.test(property) &&
			(source !== "effect" ||
				/^(Effect|Runtime|ManagedRuntime)$/.test(original ?? "")))
	) {
		return "capability-execution: execute effects at a driving adapter or composition root.";
	}
}

export function invalidEntryStatements(node: AnyJsAstNode, filePath: string) {
	if (!/\/capabilities\/[^/]+\/index\.ts$/.test(filePath)) return [];
	if (node.kind !== "JS_MODULE" && node.kind !== "JS_SCRIPT") return [];
	const statements = node.kind === "JS_MODULE" ? node.items : node.statements;
	return statements.filter(
		(statement) =>
			!(
				statement.kind === "JS_IMPORT" ||
				(statement.kind === "JS_EXPORT" &&
					["JS_EXPORT_NAMED_FROM_CLAUSE", "JS_EXPORT_NAMED_CLAUSE"].includes(
						statement.exportClause?.kind ?? "",
					))
			),
	);
}
export function isFixedWait(node: AnyJsAstNode) {
	if (node.kind !== "JS_CALL_EXPRESSION") return false;
	const callee = node.callee;
	return (
		callee?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
		callee.member?.text.trim() === "waitForTimeout"
	);
}
