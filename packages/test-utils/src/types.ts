// Message from user: This biome-ignore is allowed!
// biome-ignore-all lint/suspicious/noExplicitAny: these anys are actually needed to be able to write the very type-safe code needed.
// biome-ignore-all lint/complexity/noBannedTypes: I actually actually need some of the banned types.

// Helper: turn a tuple into a union of its element types
type TupleToUnion<T extends readonly unknown[]> = T[number];

export type TupleToIntersection<T extends readonly unknown[]> = T extends [
  infer Head,
  ...infer Tail,
]
  ? Head & TupleToIntersection<Tail>
  : unknown;
export type TupleToIntersectionOfConstructors<T extends readonly unknown[]> = T extends [
  infer Head,
  ...infer Tail,
]
  ? AnyConstructorFor<Head> & TupleToIntersectionOfConstructors<Tail>
  : {};
export type AnyConstructorFor<T> = {
  new (...args: any[]): T;
  prototype: T;
};

// Helper: check if a value V is included in tuple T (by type)
type Includes<T extends readonly unknown[], V> = V extends TupleToUnion<T> ? true : false;

// Helper: push unique values into an accumulator (set semantics)
type PushIfNotIncluded<Acc extends readonly unknown[], V> = Includes<Acc, V> extends true
  ? Acc
  : [...Acc, V];

// Main: RightMinusLeft — elements in Right that are not in Left (set difference)
export type RightMinusLeft<
  Left extends readonly unknown[],
  Right extends readonly unknown[],
  Acc extends readonly unknown[] = [],
> = Right extends readonly [infer RHead, ...infer RTail]
  ? Includes<Left, RHead> extends true
    ? RightMinusLeft<Left, RTail, Acc>
    : RightMinusLeft<Left, RTail, PushIfNotIncluded<Acc, RHead>>
  : Acc;

export type JoinStrings<T extends readonly string[], Sep extends string = ', '> = T extends []
  ? ''
  : T extends [infer Head extends string]
    ? Head
    : T extends [infer Head extends string, ...infer Tail extends string[]]
      ? `${Head}${Sep}${JoinStrings<Tail, Sep>}`
      : string;

export type AnyConstructor = new (...args: any[]) => { prototype: never };
export type Constructor<T> = new () => T;
export type ReturnTypeOf<F> = F extends (...args: any[]) => infer R ? R : never;
export type AsyncReturnTypeof<F> = F extends (...args: any[]) => Promise<infer R> ? R : never;
export type ExtractPrototype<T> = T extends { prototype: any } ? T['prototype'] : never;
