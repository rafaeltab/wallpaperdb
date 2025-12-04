import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterEach, beforeAll } from "vitest";
import { InProcessGatewayTesterBuilder } from "./builders/InProcessGatewayBuilder.js";

export let tester: ReturnType<typeof setup>;

const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
        .with(DockerTesterBuilder)
        .with(OpenSearchTesterBuilder)
        .with(NatsTesterBuilder)
        .with(InProcessGatewayTesterBuilder)
        .build();

    const t = new TesterClass();

    t
        .withNats((n) => n.withJetstream())
        .withStream("WALLPAPER")
        .withOpenSearch()
        .withInProcessApp();

    return t;
};

beforeAll(async () => {
    if (globalThis.__tester__ !== undefined) {
        tester = globalThis.__tester__;
        return;
    }
    if (tester !== undefined) return;
    tester = setup();
    globalThis.__tester__ = tester;

    await tester.setup();
}, 120000);

afterEach(async () => {
    await tester.cleanup();
});

declare global {
    var __tester__: ReturnType<typeof setup>;
}
