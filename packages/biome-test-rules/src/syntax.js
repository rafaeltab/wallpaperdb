// ESTree-shaped syntax views for the pinned rule algorithms. This is not a parser:
// Biome supplies every source node. Views have stable identity within one traversal.
export function stringValue(text) {
	return decodeEscapes(text.slice(1, -1));
}

// ESTree Identifier.name is decoded; native token text retains source escapes.
export function identifierValue(text) {
	return decodeEscapes(text);
}

function decodeEscapes(text) {
	return text.replace(
		/\\(?:u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])/g,
		(sequence) => {
			const value = sequence.slice(1);
			if (value.startsWith("u") || value.startsWith("x")) {
				const digits = value.startsWith("u{")
					? value.slice(2, -1)
					: value.slice(1);
				const code = Number.parseInt(digits, 16);
				return code <= 0x10ffff ? String.fromCodePoint(code) : sequence;
			}
			if (["\n", "\r", "\r\n"].includes(value)) return "";
			return (
				{ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" }[
					value
				] ?? value
			);
		},
	);
}

export function syntaxTree(root) {
	const source = root.text;
	const lineStarts = [0];
	for (
		let newline = source.indexOf("\n");
		newline !== -1;
		newline = source.indexOf("\n", newline + 1)
	) {
		lineStarts.push(newline + 1);
	}
	const location = (offset) => {
		const position = Math.min(offset, source.length);
		let low = 0;
		let high = lineStarts.length;
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2);
			if (lineStarts[middle] <= position) low = middle;
			else high = middle;
		}
		return { line: low + 1, column: position - lineStarts[low] };
	};
	function build(native, start = 0) {
		if (!native) return null;
		const node = {
			native,
			type: native.kind,
			range: [start, start + native.text.length],
			children: [],
		};
		node.loc = { start: location(start), end: location(node.range[1]) };
		let cursor = 0;
		function child(value) {
			if (!value) return null;
			let index = native.text.indexOf(value.text, cursor);
			if (index < 0) index = native.text.indexOf(value.text);
			const result = build(value, start + Math.max(index, 0));
			cursor = Math.max(cursor, index + value.text.length);
			if (result) {
				result.parent = node;
				node.children.push(result);
			}
			return result;
		}
		const list = (values) => (values ?? []).map(child).filter(Boolean);
		function withDefault(left, initializer) {
			if (!initializer) return left;
			const right = child(initializer.expression);
			const pattern = {
				native,
				type: "AssignmentPattern",
				range: [left.range[0], right.range[1]],
				loc: { start: left.loc.start, end: right.loc.end },
				parent: node,
				left,
				right,
				children: [left, right],
			};
			for (const entry of pattern.children) entry.parent = pattern;
			node.children = node.children.filter((n) => n !== left && n !== right);
			node.children.push(pattern);
			return pattern;
		}
		switch (native.kind) {
			case "JS_MODULE":
			case "JS_SCRIPT":
				node.type = "Program";
				node.body = list(native.items ?? native.statements);
				break;
			case "JS_PARENTHESIZED_EXPRESSION":
			case "JS_PARENTHESIZED_ASSIGNMENT":
				return child(native.expression ?? native.assignment);
			case "JS_IDENTIFIER_EXPRESSION":
				node.type = "Identifier";
				node.name = identifierValue(native.name?.text ?? native.text);
				node.native = native.name ?? native;
				break;
			case "JS_IDENTIFIER_BINDING":
			case "JS_REFERENCE_IDENTIFIER":
			case "JS_IDENTIFIER_ASSIGNMENT":
				node.type = "Identifier";
				node.name = identifierValue(native.text);
				break;
			case "JS_LITERAL_MEMBER_NAME":
				node.type = /^["']/.test(native.text) ? "Literal" : "Identifier";
				if (node.type === "Literal") node.value = stringValue(native.text);
				else node.name = identifierValue(native.text);
				break;
			case "JS_STRING_LITERAL_EXPRESSION":
				node.type = "Literal";
				node.value = stringValue(native.text);
				break;
			case "JS_NUMBER_LITERAL_EXPRESSION":
			case "JS_BOOLEAN_LITERAL_EXPRESSION":
			case "JS_NULL_LITERAL_EXPRESSION":
				node.type = "Literal";
				node.value =
					native.text === "true"
						? true
						: native.text === "false"
							? false
							: native.text === "null"
								? null
								: Number(native.text);
				break;
			case "JS_CALL_EXPRESSION":
			case "JS_NEW_EXPRESSION":
				node.type =
					native.kind === "JS_CALL_EXPRESSION"
						? "CallExpression"
						: "NewExpression";
				node.callee = child(native.callee);
				node.arguments = list(native.arguments?.args);
				break;
			case "JS_STATIC_MEMBER_EXPRESSION":
			case "JS_COMPUTED_MEMBER_EXPRESSION":
				node.type = "MemberExpression";
				node.computed = native.kind === "JS_COMPUTED_MEMBER_EXPRESSION";
				node.object = child(native.object);
				node.property = child(native.member);
				break;
			case "JS_NAME":
				node.type = "Identifier";
				node.name = identifierValue(native.text);
				break;
			case "JS_AWAIT_EXPRESSION":
			case "JS_UNARY_EXPRESSION":
			case "JS_SPREAD":
				node.type =
					native.kind === "JS_AWAIT_EXPRESSION"
						? "AwaitExpression"
						: native.kind === "JS_SPREAD"
							? "SpreadElement"
							: "UnaryExpression";
				node.operator = native.operatorToken;
				node.argument = child(native.argument);
				break;
			case "JS_RETURN_STATEMENT":
				node.type = "ReturnStatement";
				node.argument = child(native.argument);
				break;
			case "JS_EXPRESSION_STATEMENT":
				node.type = "ExpressionStatement";
				node.expression = child(native.expression);
				break;
			case "JS_VARIABLE_STATEMENT":
				return child(native.declaration);
			case "JS_VARIABLE_DECLARATION":
				node.type = "VariableDeclaration";
				node.declarations = list(native.declarators);
				break;
			case "JS_VARIABLE_DECLARATOR":
				node.type = "VariableDeclarator";
				node.id = child(native.id);
				node.init = child(native.initializer?.expression);
				break;
			case "JS_ARROW_FUNCTION_EXPRESSION":
			case "JS_FUNCTION_EXPRESSION":
			case "JS_FUNCTION_DECLARATION":
				node.type =
					native.kind === "JS_ARROW_FUNCTION_EXPRESSION"
						? "ArrowFunctionExpression"
						: native.kind === "JS_FUNCTION_EXPRESSION"
							? "FunctionExpression"
							: "FunctionDeclaration";
				node.async = !!native.asyncToken;
				node.id = child(native.id);
				node.params = list(
					native.parameters?.kind === "JS_PARAMETERS"
						? native.parameters.items
						: native.parameters
							? [native.parameters]
							: [],
				);
				node.body = child(native.body);
				break;
			case "JS_FORMAL_PARAMETER":
				return withDefault(child(native.binding), native.initializer);
			case "JS_FUNCTION_BODY":
			case "JS_BLOCK_STATEMENT":
				node.type = "BlockStatement";
				node.body = list(native.statements);
				break;
			case "JS_ARRAY_EXPRESSION":
				node.type = "ArrayExpression";
				node.elements = list(native.elements);
				break;
			case "JS_OBJECT_EXPRESSION":
			case "JS_OBJECT_BINDING_PATTERN":
				node.type =
					native.kind === "JS_OBJECT_EXPRESSION"
						? "ObjectExpression"
						: "ObjectPattern";
				node.properties = list(native.members ?? native.properties);
				break;
			case "JS_PROPERTY_OBJECT_MEMBER":
			case "JS_OBJECT_BINDING_PATTERN_PROPERTY":
				node.type = "Property";
				node.computed =
					(native.name ?? native.member)?.kind === "JS_COMPUTED_MEMBER_NAME";
				node.key = child(native.name ?? native.member);
				node.value = withDefault(
					child(native.value ?? native.pattern),
					native.init,
				);
				break;
			case "JS_METHOD_OBJECT_MEMBER":
			case "JS_GETTER_OBJECT_MEMBER":
			case "JS_SETTER_OBJECT_MEMBER":
			case "JS_CONSTRUCTOR_CLASS_MEMBER":
			case "JS_GETTER_CLASS_MEMBER":
			case "JS_SETTER_CLASS_MEMBER":
			case "JS_METHOD_CLASS_MEMBER": {
				node.type = native.kind.endsWith("_CLASS_MEMBER")
					? "MethodDefinition"
					: "Property";
				node.decorators = list(native.modifiers);
				node.computed = native.name?.kind === "JS_COMPUTED_MEMBER_NAME";
				node.key = child(native.name);
				const fn = {
					native,
					type: "FunctionExpression",
					range: node.range,
					loc: node.loc,
					parent: node,
					children: [],
				};
				fn.async = !!native.asyncToken;
				fn.params = list(
					native.parameters?.items ??
						native.parameters?.parameters ??
						(native.parameter ? [native.parameter] : []),
				);
				fn.body = child(native.body);
				fn.children = [...fn.params, fn.body].filter(Boolean);
				for (const entry of fn.children) entry.parent = fn;
				node.value = fn;
				node.children = [...node.decorators, node.key, fn].filter(Boolean);
				break;
			}
			case "JS_SHORTHAND_PROPERTY_OBJECT_MEMBER":
			case "JS_OBJECT_BINDING_PATTERN_SHORTHAND_PROPERTY":
				node.type = "Property";
				node.key = child(native.name ?? native.identifier);
				node.value = withDefault(
					child(native.name ?? native.identifier),
					native.init,
				);
				break;
			case "JS_COMPUTED_MEMBER_NAME":
				return child(native.expression);
			case "JS_CONDITIONAL_EXPRESSION":
				node.type = "ConditionalExpression";
				node.test = child(native.test);
				node.consequent = child(native.consequent);
				node.alternate = child(native.alternate);
				break;
			case "JS_ASSIGNMENT_EXPRESSION":
			case "JS_LOGICAL_EXPRESSION":
			case "JS_BINARY_EXPRESSION":
				node.type =
					native.kind === "JS_ASSIGNMENT_EXPRESSION"
						? "AssignmentExpression"
						: native.kind === "JS_LOGICAL_EXPRESSION"
							? "LogicalExpression"
							: "BinaryExpression";
				node.operator = native.operatorToken;
				node.left = child(native.left);
				node.right = child(native.right);
				break;
			case "JS_SEQUENCE_EXPRESSION": {
				node.type = "SequenceExpression";
				const left = child(native.left);
				const right = child(native.right);
				node.expressions =
					left?.type === "SequenceExpression"
						? [...left.expressions, right]
						: [left, right];
				node.children = node.expressions;
				for (const entry of node.children) entry.parent = node;
				break;
			}
			case "JS_TEMPLATE_EXPRESSION": {
				if (native.tag) {
					node.type = "TaggedTemplateExpression";
					node.tag = child(native.tag);
				} else node.type = "TemplateLiteral";
				// ESTree keeps one quasi on each side of every interpolation,
				// including empty boundaries omitted from Biome's chunk elements.
				node.quasis = [{ value: { raw: "" } }];
				node.expressions = [];
				for (const element of native.elements) {
					if (element.kind === "JS_TEMPLATE_CHUNK_ELEMENT")
						node.quasis.at(-1).value.raw += element.text;
					else {
						node.expressions.push(child(element.expression ?? element));
						node.quasis.push({ value: { raw: "" } });
					}
				}
				break;
			}
			case "TS_AS_EXPRESSION":
			case "TS_TYPE_ASSERTION_EXPRESSION":
			case "TS_NON_NULL_ASSERTION_EXPRESSION":
			case "TS_SATISFIES_EXPRESSION":
				node.type =
					native.kind === "TS_AS_EXPRESSION"
						? "TSAsExpression"
						: native.kind === "TS_TYPE_ASSERTION_EXPRESSION"
							? "TSTypeAssertion"
							: "TSNonNullExpression";
				node.expression = child(native.expression);
				break;
			default:
				list(native.children());
		}
		return node;
	}
	const tree = build(root);
	tree.parent = undefined;
	return tree;
}

export function visitSyntax(node, visitor) {
	visitor[node.type]?.(node);
	for (const child of node.children) visitSyntax(child, visitor);
	visitor[`${node.type}:exit`]?.(node);
}
