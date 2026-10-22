import { identifierValue, stringValue } from "./syntax.js";

// The pinned accessor helpers use raw text for no-substitution templates.
function staticTemplateValue(node) {
	if (
		node?.kind !== "JS_TEMPLATE_EXPRESSION" ||
		node.tag ||
		!node.elements.every((e) => e.kind === "JS_TEMPLATE_CHUNK_ELEMENT")
	)
		return undefined;
	return node.elements.map((e) => e.text).join("");
}

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
				imported: {
					name: identifierValue(native.parent?.name?.text ?? native.text),
				},
			},
		};
	const scope = binding.scope().syntax();
	let owner = identifier;
	while (owner.parent && owner.native.text !== scope.text) owner = owner.parent;
	const variable = context.nodes.find(
		(n) =>
			n.type === "VariableDeclarator" &&
			n.id?.name === identifierValue(native.text) &&
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
			if (
				identifierValue(
					first?.member?.text ?? first?.identifier?.text ?? "",
				) === identifier
			)
				return "testContext";
			const named = params
				.map((p) => p.binding ?? p)
				.find((p) => p.kind === "JS_IDENTIFIER_BINDING");
			let call = fn?.parent;
			while (
				call &&
				[
					"JS_CALL_ARGUMENT_LIST",
					"JS_CALL_ARGUMENTS",
					"JS_PARENTHESIZED_EXPRESSION",
				].includes(call.kind)
			)
				call = call.parent;
			if (
				named &&
				call?.kind === "JS_CALL_EXPRESSION" &&
				call.callee?.kind === "JS_IDENTIFIER_EXPRESSION" &&
				["it", "test", "fit", "xit", "xtest"].includes(
					identifierValue(call.callee.text),
				)
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
				imported: identifierValue(parent.name.text),
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
			identifierValue(init.callee.member?.text ?? "") === "extend"
		) {
			const root = identifierValue(
				init.callee.object?.text.split(".")[0] ?? "",
			);
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
		// describeVariableDefAsImport accepts only destructuring from an awaited
		// import or a require call. Plain initializer aliases remain local.
		if (
			[
				"JS_OBJECT_BINDING_PATTERN_PROPERTY",
				"JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY",
			].includes(parent?.kind)
		) {
			const declarator = ancestors.find(
				(n) => n.kind === "JS_VARIABLE_DECLARATOR",
			);
			const initializer = declarator?.initializer?.expression;
			const imported =
				initializer?.kind === "JS_AWAIT_EXPRESSION" &&
				initializer.argument?.kind === "JS_IMPORT_CALL_EXPRESSION"
					? initializer.argument
					: initializer?.kind === "JS_CALL_EXPRESSION" &&
							initializer.callee?.kind === "JS_IDENTIFIER_EXPRESSION" &&
							initializer.callee.text === "require"
						? initializer
						: undefined;
			const source = imported?.arguments?.args[0];
			const templateSource = staticTemplateValue(source);
			let key = parent.member ?? parent.identifier;
			if (key?.kind === "JS_COMPUTED_MEMBER_NAME") key = key.expression;
			if (
				(source?.kind === "JS_STRING_LITERAL_EXPRESSION" ||
					templateSource !== undefined) &&
				key
			)
				return {
					source: templateSource ?? stringValue(source.text),
					imported:
						staticTemplateValue(key) ??
						(key.kind === "JS_LITERAL_MEMBER_NAME" && /^["']/.test(key.text)
							? stringValue(key.text)
							: identifierValue(key.text)),
					local: identifier,
				};
		}
		return "local";
	}
	return null;
}
