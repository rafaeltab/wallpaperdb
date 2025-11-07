import { AddMethodsType, BaseTesterBuilder, createTesterBuilder } from "./framework";
import { AsyncReturnTypeof } from "./types";

/// Testing code
let tester: AsyncReturnTypeof<typeof setup>;

async function setup() {
    return await new MyTester()
        .withNetwork()
        .withPostgres((pg: any) => pg
            .withDatabase("db")
            .withUsername("db")
            .withPassword("pw")
        )
        .withNats()
        .setup();
}

class DockerTesterBuilder extends BaseTesterBuilder<"docker", []> {
    name = "docker" as const;

    addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
        return class Docker extends Base {
            constructor(...args: any[]) {
                super(...args);
            }

            withNetwork() {
                this.addSetupHook(async () => {
                    console.log("Setting up docker")
                });
                return this;
            }
        }
    }
}

class PostgresTesterBuilder extends BaseTesterBuilder<"postgres", [DockerTesterBuilder]> {
    name = "postgres" as const;

    addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
        return class Postgres extends Base {
            withPostgres(configure: (a: any) => any) {
                return this;
            }
        }
    }
}

class NatsTesterBuilder extends BaseTesterBuilder<"nats", [DockerTesterBuilder]> {
    name = "nats" as const;

    addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
        return class Nats extends Base {
            withNats() {
                return this;
            }
        }
    }
}

const MyTester = createTesterBuilder()
    .with(DockerTesterBuilder)
    .with(PostgresTesterBuilder)
    .with(NatsTesterBuilder)
    .build();
