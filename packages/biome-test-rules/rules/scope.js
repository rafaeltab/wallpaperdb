import { stringValue } from "./syntax.js";

export const getScope = (context, node) => context.model.scope(node.native);

export function definition(context, identifier) {
	const binding = context.model.binding(identifier.native);
	if (!binding) return undefined;
	const native = binding.syntax();
	const clause = native
		.ancestors()
		.find((n) =>
			[
				"JS_IMPORT_NAMED_CLAUSE",
				"JS_IMPORT_NAMESPACE_CLAUSE",
				"JS_IMPORT_COMBINED_CLAUSE",
			].includes(n.kind),
		);
	if (clause)
		return {
			type: "ImportBinding",
			parent: { source: { value: stringValue(clause.source.text) } },
			node: {
				type:
					native.parent?.kind === "JS_NAMESPACE_IMPORT_SPECIFIER"
						? "ImportNamespaceSpecifier"
						: "ImportSpecifier",
				imported: { name: native.parent?.name?.text ?? native.text },
			},
		};
	const scope = binding.scope().syntax();
	let owner = identifier;
	while (owner.parent && owner.native.text !== scope.text) owner = owner.parent;
	const variable = context.nodes.find(
		(n) =>
			n.type === "VariableDeclarator" &&
			n.id?.name === native.text &&
			n.native.text === native.parent?.text &&
			n.range[0] >= owner.range[0] &&
			n.range[1] <= owner.range[1],
	);
	return variable ? { type: "Variable", node: variable } : { type: "Other" };
}

// Translation of the pinned parser's resolveScope: inspect declaration kind,
// parameter shape and imports, rather than following arbitrary value aliases.
export function resolveScope(scope, identifier) {
	for (let current = scope; current; current = current.parent()) {
		const binding = current.getBinding(identifier);
		if (!binding) continue;
		const declaration = binding.syntax();
		const ancestors = declaration.ancestors();
		const parameter = ancestors.find((n) => n.kind === "JS_FORMAL_PARAMETER");
		if (
			parameter ||
			declaration.parent?.kind === "JS_ARROW_FUNCTION_EXPRESSION"
		) {
			const fn = ancestors.find((n) =>
				[
					"JS_ARROW_FUNCTION_EXPRESSION",
					"JS_FUNCTION_EXPRESSION",
					"JS_FUNCTION_DECLARATION",
				].includes(n.kind),
			);
			const params =
				fn?.parameters?.items ?? (fn?.parameters ? [fn.parameters] : []);
			const object = params
				.map((p) => p.binding ?? p)
				.find((p) => p.kind === "JS_OBJECT_BINDING_PATTERN");
			const first = object?.properties.find((p) =>
				[
					"JS_OBJECT_BINDING_PATTERN_PROPERTY",
					"JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY",
				].includes(p.kind),
			);
			if ((first?.member?.text ?? first?.identifier?.text) === identifier)
				return "testContext";
			const named = params
				.map((p) => p.binding ?? p)
				.find((p) => p.kind === "JS_IDENTIFIER_BINDING");
			const call = fn?.ancestors().find((n) => n.kind === "JS_CALL_EXPRESSION");
			if (
				named &&
				["it", "test", "fit", "xit", "xtest"].includes(call?.callee?.text)
			)
				return "testContext";
		}
		const parent = declaration.parent;
		const clause = ancestors.find((n) =>
			["JS_IMPORT_NAMED_CLAUSE", "JS_IMPORT_COMBINED_CLAUSE"].includes(n.kind),
		);
		if (clause && parent?.kind === "JS_NAMED_IMPORT_SPECIFIER") {
			if (clause.typeToken === "type") return "local";
			return {
				source: stringValue(clause.source.text),
				imported: parent.name.text,
				local: identifier,
			};
		}
		if (clause && parent?.kind === "JS_SHORTHAND_NAMED_IMPORT_SPECIFIER") {
			if (clause.typeToken === "type") return "local";
			return {
				source: stringValue(clause.source.text),
				imported: identifier,
				local: identifier,
			};
		}
		const variable =
			parent?.kind === "JS_VARIABLE_DECLARATOR" ? parent : undefined;
		const init = variable?.initializer?.expression;
		if (
			init?.kind === "JS_CALL_EXPRESSION" &&
			init.callee?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
			init.callee.member?.text === "extend"
		) {
			const root = init.callee.object?.text.split(".")[0];
			if (root && root !== identifier) {
				const base = resolveScope(current, root);
				if (
					base &&
					typeof base === "object" &&
					["it", "test", "fit", "xit", "xtest"].includes(base.imported)
				)
					return { ...base, local: identifier };
			}
		}
		return "local";
	}
	return null;
}
