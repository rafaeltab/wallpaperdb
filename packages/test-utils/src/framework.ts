// biome-ignore-all lint/suspicious/noExplicitAny: these anys are actually needed to be able to write the very type-safe code needed.
import type {
  AnyConstructorFor,
  Constructor,
  ExtractPrototype,
  JoinStrings,
  ReturnTypeOf,
  RightMinusLeft,
  TupleToIntersectionOfConstructors,
} from './types';

type AnyTester = BaseTesterBuilder<string, AnyTester[]>;
type TupleOfTesters = AnyTester[];

type InferAddMethod<TTester extends AnyTester> = TTester['addMethods'];
type InferName<TTester extends AnyTester> = TTester extends BaseTesterBuilder<
  infer Name,
  AnyTester[]
>
  ? Name
  : never;
type InferNames<TTesters extends TupleOfTesters, Names extends string[] = []> = TTesters extends [
  infer Head extends AnyTester,
  ...infer Rest extends TupleOfTesters,
]
  ? InferNames<Rest, [InferName<Head>, ...Names]>
  : Names;
type InferConstructorClass<TConstructor extends Constructor<unknown>> =
  TConstructor extends Constructor<infer T> ? T : never;
type InferRequiredTesters<TTester extends AnyTester> = TTester extends BaseTesterBuilder<
  string,
  infer Required extends TupleOfTesters
>
  ? Required
  : never;
type InferAddMethodReturnType<TTester extends AnyTester> = ReturnTypeOf<InferAddMethod<TTester>>;
type InferAddMethodClass<TTester extends AnyTester> = ExtractPrototype<
  InferAddMethodReturnType<TTester>
>;
type InferAddMethodClasses<TTesters extends TupleOfTesters> = TTesters extends [
  infer Head extends AnyTester,
  ...infer Rest extends TupleOfTesters,
]
  ? [InferAddMethodClass<Head>, ...InferAddMethodClasses<Rest>]
  : [];

type MissingTesters<
  TRequired extends TupleOfTesters,
  TAvailable extends TupleOfTesters,
> = RightMinusLeft<TAvailable, TRequired>;
type RequireTesters<
  TType,
  TRequiredTesters extends TupleOfTesters,
  TAvailable extends TupleOfTesters,
> = MissingTesters<TRequiredTesters, TAvailable> extends []
  ? TType
  : `Some testers require testers that aren't already added. The required testers are ${JoinStrings<InferNames<MissingTesters<TRequiredTesters, TAvailable>>>}`;

// Somehow an ...any[] was sneaking in, so this prevents that issue.
type MergeTester<
  TTester extends AnyTester,
  TTesters extends TupleOfTesters,
> = any[] extends TTesters ? [TTester] : [TTester, ...TTesters];

/**
 * Base Tester class.
 * This class is now empty - all lifecycle methods are provided by lifecycle builders.
 *
 * IMPORTANT: All tests must include SetupTesterBuilder, CleanupTesterBuilder, and DestroyTesterBuilder
 * to enable the setup(), cleanup(), and destroy() methods.
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)      // Provides setup()
 *   .with(CleanupTesterBuilder)    // Provides cleanup()
 *   .with(DestroyTesterBuilder)    // Provides destroy()
 *   .with(DockerTesterBuilder)
 *   // ... other builders
 *   .build();
 * ```
 */
class Tester {
  // Empty base class - all functionality from builders
}

class TesterBuilder<TTesters extends TupleOfTesters = []> {
  /** @internal */
  _testers: TupleOfTesters = [];

  constructor(testers: TupleOfTesters) {
    this._testers = testers;
  }

  public with<
    TTesterConstructor extends Constructor<AnyTester>,
    TTester extends AnyTester = InferConstructorClass<TTesterConstructor>,
    TRequiredTesters extends TupleOfTesters = InferRequiredTesters<TTester>,
  >(
    testerConstructor: RequireTesters<TTesterConstructor, TRequiredTesters, TTesters>
  ): TesterBuilder<MergeTester<TTester, TTesters>> {
    if (typeof testerConstructor === 'string') {
      throw '';
    }

    return new TesterBuilder([new testerConstructor(), ...this._testers]);
  }

  public build(): AddMethodsType<[...TTesters]> {
    let ctor = Tester;
    for (const tester of this._testers) {
      ctor = tester.addMethods(ctor);
    }
    return ctor as any as AddMethodsType<[...TTesters]>;
  }
}

/**
 * Create a new empty TesterBuilder.
 * This is the low-level API - consider using createDefaultTesterBuilder() instead.
 *
 * @returns Empty TesterBuilder
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)
 *   .with(CleanupTesterBuilder)
 *   .with(DestroyTesterBuilder)
 *   .with(DockerTesterBuilder)
 *   .build();
 * ```
 */
export function createTesterBuilder(): TesterBuilder<[]> {
  return new TesterBuilder<[]>([]);
}

export abstract class BaseTesterBuilder<
  TName extends string,
  TRequiredTesters extends TupleOfTesters = [],
> {
  abstract name: TName;

  abstract addMethods<TBase extends AddMethodsType<TRequiredTesters>>(
    Base: TBase
  ): AnyConstructorFor<any>;
}

export type AddMethodsType<TRequiredTesters extends TupleOfTesters> =
  AnyTester[] extends TRequiredTesters
    ? any
    : TupleToIntersectionOfConstructors<[...InferAddMethodClasses<TRequiredTesters>, Tester]>;

/**
 * Extracts the class type created by a builder's addMethods() function.
 * This is useful for creating helper classes that need access to the parent tester instance.
 *
 * @example
 * ```typescript
 * class PostgresHelpers {
 *   constructor(private tester: TesterInstance<PostgresTesterBuilder>) {}
 *
 *   async query(sql: string) {
 *     const config = this.tester.getPostgresConfig();
 *     // ... use config
 *   }
 * }
 * ```
 */
export type TesterInstance<TTester extends AnyTester> = InferAddMethodClass<TTester>;
