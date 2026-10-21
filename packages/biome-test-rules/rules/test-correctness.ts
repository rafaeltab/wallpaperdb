import {
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";

export const validExpect = defineRule({
	query: semantic("JS_CALL_EXPRESSION"),
	run(node) {
		if (node.callee?.text !== "expect") return;
		let expression = node.parent;
		while (expression?.kind === "JS_STATIC_MEMBER_EXPRESSION") {
			expression = expression.parent;
		}
		if (expression?.kind !== "JS_CALL_EXPRESSION") {
			registerDiagnostic(
				node,
				"error",
				"Complete the assertion with a matcher.",
			);
		}
	},
});
