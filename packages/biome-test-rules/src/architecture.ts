import {
	ast,
	defineRule,
	registerDiagnostic,
	semantic,
} from "@biomejs/runtime/plugin";
import {
	capabilityViolation,
	invalidEntryStatements,
} from "./guideline-policy.ts";

// Keep native queries here; the directly measured policy shares these same
// native nodes and binding results without parsing or traversing a second tree.
export const capabilityExecution = defineRule({
	query: semantic("JS_REFERENCE_IDENTIFIER"),
	run(node, context) {
		const message = capabilityViolation(node, context.model.binding(node));
		if (message) registerDiagnostic(node, "error", message);
	},
});
export const capabilityEntry = defineRule({
	query: ast("JS_MODULE", "JS_SCRIPT"),
	run(node, context) {
		for (const statement of invalidEntryStatements(node, context.filePath))
			registerDiagnostic(
				statement,
				"error",
				"capability-entry: use explicit named exports of imported contracts; declare contracts in contract.ts and behavior in private implementation files.",
			);
	},
});
