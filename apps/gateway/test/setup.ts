import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import { container } from "tsyringe";
import { afterEach, beforeAll } from "vitest";
import { IndexManagerService } from "../src/services/index-manager.service.js";
import { InProcessGatewayTesterBuilder } from "./builders/InProcessGatewayBuilder.js";

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
        .withNatsAutoCleanup()
        .withOpenSearch()
        .withInProcessApp();

    return t;
};

export let tester: ReturnType<typeof setup>;

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
    const indexManager = container.resolve(IndexManagerService);
    await indexManager.deleteIndex();
    await indexManager.createIndex();
});

declare global {
    var __tester__: ReturnType<typeof setup>;
}
