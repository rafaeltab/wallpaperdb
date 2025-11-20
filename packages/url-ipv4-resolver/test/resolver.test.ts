import { describe, expect, it } from "vitest";
import { resolveUrlIpv4 } from "../src/index.ts";

const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
describe("Resolver", () => {
    it("Leaves IP addresses as is", async () => {
        const given = "127.0.0.1";

        const result = await resolveUrlIpv4(given);

        expect(result, "127.0.0.1");
    });

    it("Should resolve plain localhost to 127.0.0.1", async () => {
        const given = "localhost";

        const result = await resolveUrlIpv4(given);

        expect(result, "127.0.0.1");
    });

    it("Should resolve example.com to an ip", async () => {
        const given = "example.com";

        const result = await resolveUrlIpv4(given);

        expect(result).toMatch(ipv4Regex);
    });

    it("Should resolve plain localhost to 127.0.0.1 inside a sql connectionstring", async () => {
        const given =
            "postgres://username:password@localhost:5432/database_name?sslmode=disable";

        const result = await resolveUrlIpv4(given);

        expect(
            result,
            "postgres://username:password@127.0.0.1:5432/database_name?sslmode=disable",
        );
    });
});
