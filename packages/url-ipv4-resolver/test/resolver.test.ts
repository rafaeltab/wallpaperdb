import { lookup } from "node:dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUrlIpv4 } from "../src/index.ts";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const lookupMock = vi.mocked(lookup);

beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockRejectedValue(new Error("Unexpected DNS lookup"));
});

describe("Resolver", () => {
    it.each(["127.0.0.1", "203.0.113.42"])(
        "leaves IPv4 address %s unchanged without DNS",
        async (given) => {
            expect(await resolveUrlIpv4(given)).toBe(given);
            expect(lookupMock).not.toHaveBeenCalled();
        },
    );

    it.each([
        ["localhost", "127.0.0.1"],
        ["example.com", "203.0.113.42"],
    ])("resolves bare hostname %s to the DNS result", async (host, address) => {
        lookupMock.mockResolvedValueOnce({ address, family: 4 });

        expect(await resolveUrlIpv4(host)).toBe(address);
        expect(lookupMock).toHaveBeenCalledExactlyOnceWith(host, { family: 4 });
    });

    it("replaces a connection string hostname while retaining its other components", async () => {
        lookupMock.mockResolvedValueOnce({ address: "127.0.0.1", family: 4 });

        const result = await resolveUrlIpv4(
            "postgres://username:password@localhost:5432/database_name?sslmode=disable#section",
        );

        expect(result).toBe(
            "postgres://username:password@127.0.0.1:5432/database_name?sslmode=disable#section",
        );
        expect(lookupMock).toHaveBeenCalledExactlyOnceWith("localhost", {
            family: 4,
        });
    });

    it("uses the returned DNS address in a URL", async () => {
        lookupMock.mockResolvedValueOnce({ address: "203.0.113.42", family: 4 });

        expect(await resolveUrlIpv4("https://example.com/path?q=value")).toBe(
            "https://203.0.113.42/path?q=value",
        );
        expect(lookupMock).toHaveBeenCalledExactlyOnceWith("example.com", {
            family: 4,
        });
    });

    it.each(["example.com", "https://example.com/path"])(
        "propagates DNS failure for %s",
        async (given) => {
            const failure = new Error("DNS unavailable");
            lookupMock.mockRejectedValueOnce(failure);

            await expect(resolveUrlIpv4(given)).rejects.toBe(failure);
        },
    );
});
