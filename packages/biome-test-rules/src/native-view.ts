import type { AnyJsAstNode } from "@biomejs/runtime/plugin";

type Keys<T> = T extends unknown ? keyof T : never;
type View<T> = T extends AnyJsAstNode
	? NativeVariant<T>
	: T extends readonly (infer E)[]
		? readonly View<E>[]
		: T extends (...args: infer A) => infer R
			? (...args: A) => View<R>
			: T;

// The compatibility adapter reads alternate fields across related native kinds
// with nullish fallbacks. Keep the runtime's field types, while permitting those
// reads without duplicating its generated AST declarations.
type NativeVariant<N extends AnyJsAstNode> = {
	[K in keyof N]: View<N[K]>;
} & { [K in Exclude<Keys<AnyJsAstNode>, keyof N>]?: undefined };
export type NativeNode = View<AnyJsAstNode>;

export function nativeView(node: AnyJsAstNode): NativeNode {
	return node as unknown as NativeNode;
}
