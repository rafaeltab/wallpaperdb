# Testing

Example of some setup code I would like to be able to use:

`apps/ingestor/tests/tester.ts`
```ts
class IngestorFromSource extends BaseTesterBuilderMixin<TesterBuilder & PostgresTester & NatsTester> {// Generic to indicate what other testers are needed
    public register<TBase extends >() {

    }
}

class IngestorFaker extends Faker {
    
}

const TesterBuilder = createTesterBuilder()
    .with(DockerTester)
    .with(PostgresTester)
    .with(NatsTester)
    .with(IngestorFromSource);
```

`apps/ingestor/tests/sometest.test.ts`
```ts
let tester: TesterFromSetup<typeof setup>;
let config: ConfigFromTester<typeof tester>;

async function setup() {
    return await new TesterBuilder()
        .withNetwork()
        .withPostgres((pg) => pg
            .withDatabase("db")
            .withUsername("db")
            .withPassword("pw")
        ) // Optional customizable config (otherwise resorts to default). Due to `withNetwork` the postgres automatically uses the network.
        .withNats()
        .setup();
}

beforeEach(async() => {
    tester = await setup();
    config = tester.config;
});
