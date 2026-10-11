import { Client } from "@opensearch-project/opensearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenSearchContainer, type StartedOpenSearchContainer } from "../src/index";

const image = "opensearchproject/opensearch:2.19.2";

function createClient(container: StartedOpenSearchContainer, index: string) {
    const client = new Client({
        node: container.getHttpUrl("host"),
        auth: {
            username: container.getUsername(),
            password: container.getPassword(),
        },
        ssl: {
            rejectUnauthorized: false,
        },
    });

    return Object.assign(client, {
        async [Symbol.asyncDispose]() {
            try {
                await client.indices.delete({ index, ignore_unavailable: true });
            } finally {
                await client.close();
            }
        },
    });
}

describe("OpenSearchContainer", { timeout: 180_000 }, () => {
    describe("default configuration", () => {
        let container: StartedOpenSearchContainer;

        beforeAll(async () => {
            container = await new OpenSearchContainer(image).start();
        }, 180_000);

        afterAll(async () => {
            await container?.stop();
        }, 180_000);

        it("should create an index with %s", async () => {
            // opensearchCreateIndex {
            const index = "people-create-index";
            await using client = createClient(container, index);

            await client.indices.create({ index });

            const { body } = await client.indices.exists({ index });
            expect(body).toBe(true);
            // }
        });

        it("should index a document", async () => {
            // opensearchIndexDocument {
            const index = "people-index-document";
            await using client = createClient(container, index);

            const document = { id: "1", name: "John Doe" };

            await client.index({
                index,
                id: document.id,
                body: document,
            });

            const { body } = await client.get({ index, id: document.id });
            expect(body._source).toEqual(document);
            // }
        });
    });

    it("should work with restarted container", async () => {
        await using container = await new OpenSearchContainer(image).start();
        await container.restart();

        const index = "people";
        await using client = createClient(container, index);

        await client.indices.create({ index });

        const existsResponse = await client.indices.exists({ index });
        expect(existsResponse.body).toBe(true);
    });

    it("should throw when given an invalid password", () => {
        expect(() =>
            new OpenSearchContainer(image).withPassword("weakpwd"),
        ).toThrowError(/Password "weakpwd" is too weak/);
    });

    it("should set custom password", async () => {
        // opensearchCustomPassword {
        await using container = await new OpenSearchContainer(image)
            .withPassword("Str0ng!Passw0rd2025")
            .start();
        // }

        const index = "people";
        await using client = createClient(container, index);

        await client.indices.create({ index });

        const { body } = await client.indices.exists({ index });
        expect(body).toBe(true);
    });
});
