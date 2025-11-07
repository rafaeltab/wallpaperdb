import { AnyConstructorFor, Constructor, ExtractPrototype, JoinStrings, ReturnTypeOf, RightMinusLeft, TupleToIntersection, TupleToIntersectionOfConstructors } from "./types";

type AnyTester = BaseTesterBuilder<string, AnyTester[]>;
type TupleOfTesters = AnyTester[]

type InferAddMethod<TTester extends AnyTester> = TTester["addMethods"];
type InferName<TTester extends AnyTester> = TTester extends BaseTesterBuilder<infer Name, AnyTester[]> ? Name : never;
type InferNames<TTesters extends TupleOfTesters, Names extends string[] = []> = TTesters extends [infer Head extends AnyTester, ...infer Rest extends TupleOfTesters] ? InferNames<Rest, [InferName<Head>, ...Names]> : Names;
type InferConstructorClass<TConstructor extends Constructor<unknown>> = TConstructor extends Constructor<infer T> ? T : never;
type InferRequiredTesters<TTester extends AnyTester> = TTester extends BaseTesterBuilder<string, infer Required extends TupleOfTesters> ? Required : never;
type InferAddMethodReturnType<TTester extends AnyTester> = ReturnTypeOf<InferAddMethod<TTester>>;
type InferAddMethodClass<TTester extends AnyTester> = ExtractPrototype<InferAddMethodReturnType<TTester>>;
type InferAddMethodClasses<TTesters extends TupleOfTesters> = TTesters extends [infer Head extends AnyTester, ...infer Rest extends TupleOfTesters] ? [InferAddMethodClass<Head>, ...InferAddMethodClasses<Rest>] : [];

type MissingTesters<TRequired extends TupleOfTesters, TAvailable extends TupleOfTesters> = RightMinusLeft<TAvailable, TRequired>;
type RequireTesters<TType, TRequiredTesters extends TupleOfTesters, TAvailable extends TupleOfTesters> =
    MissingTesters<TRequiredTesters, TAvailable> extends [] ? TType :
    `Some testers require testers that aren't already added. The required testers are ${JoinStrings<InferNames<MissingTesters<TRequiredTesters, TAvailable>>>}`;

// Somehow an ...any[] was sneaking in, so this prevents that issue.
type MergeTester<TTester extends AnyTester, TTesters extends TupleOfTesters> = any[] extends TTesters ? [TTester] : [TTester, ...TTesters];


class Tester {
    constructor(...args: any) { }

    private setupHooks: (() => Promise<void>)[] = [];
    private destroyHooks: (() => Promise<void>)[] = [];

    protected addSetupHook(hook: () => Promise<void>) {
        this.setupHooks.push(hook);
    }

    protected addDestroyHook(hook: () => Promise<void>) {
        this.destroyHooks.push(hook);
    }

    public async setup() {
        for (const setupHook of this.setupHooks) {
            await setupHook();
        }
        return this;
    }

    public async destroy() {
        for (const destroyHook of this.destroyHooks) {
            await destroyHook();
        }
        return this;
    }
}

class TesterBuilder<TTesters extends TupleOfTesters = []> {
    private testers: TupleOfTesters = [];

    constructor(testers: TupleOfTesters) {
        this.testers = testers;
    }

    public with<
        TTesterConstructor extends Constructor<AnyTester>,
        TTester extends AnyTester = InferConstructorClass<TTesterConstructor>,
        TRequiredTesters extends TupleOfTesters = InferRequiredTesters<TTester>
    >(testerConstructor: RequireTesters<TTesterConstructor, TRequiredTesters, TTesters>): TesterBuilder<MergeTester<TTester, TTesters>> {
        if (typeof testerConstructor == "string") {
            throw "";
        }

        return new TesterBuilder([new testerConstructor(), ...this.testers]);
    }

    public build(): AddMethodsType<[...TTesters]> {
        let ctor = Tester;
        for (const tester of this.testers) {
            ctor = tester.addMethods(ctor);
        }
        return ctor as any as AddMethodsType<[...TTesters]>;
    }
}

export function createTesterBuilder(): TesterBuilder<[]> {
    return new TesterBuilder<[]>([]);
}

export abstract class BaseTesterBuilder<TName extends string, TRequiredTesters extends TupleOfTesters = []> {
    private e: TRequiredTesters = [] as any;
    abstract name: TName;

    abstract addMethods<TBase extends AddMethodsType<TRequiredTesters>>(Base: TBase): AnyConstructorFor<any>;
}

export type AddMethodsType<TRequiredTesters extends TupleOfTesters> = AnyTester[] extends TRequiredTesters ? any : TupleToIntersectionOfConstructors<[...InferAddMethodClasses<TRequiredTesters>, Tester]>;
