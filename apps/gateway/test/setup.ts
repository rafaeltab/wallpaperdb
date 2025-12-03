import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, afterEach, beforeAll } from "vitest";
import { InProcessGatewayTesterBuilder } from "./builders/InProcessGatewayBuilder.js";

const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
        .with(DockerTesterBuilder)
        .with(OpenSearchTesterBuilder)
        .with(NatsTesterBuilder)
        .with(InProcessGatewayTesterBuilder)
        .build();

    const tester = new TesterClass();

    tester
        .withNats((n) => n.withJetstream())
        .withStream("WALLPAPER")
        .withOpenSearch()
        .withInProcessApp();

    return tester;
};

export let tester: ReturnType<typeof setup>;

beforeAll(async () => {
    tester = setup();
    await tester.setup();
}, 60000);

afterAll(async () => {
    await tester.destroy();
});

afterEach(async () => {
    await tester.cleanup();
});
