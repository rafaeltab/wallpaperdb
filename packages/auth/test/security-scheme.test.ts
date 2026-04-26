import { describe, it, expect } from "vitest";
import { getClerkSecuritySchemes } from "../src/index.js";

describe("getClerkSecuritySchemes", () => {
  it("should return an object with a clerkOAuth key", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://example.clerk.accounts.dev",
    });

    expect(schemes).toBeDefined();
    expect(schemes.clerkOAuth).toBeDefined();
  });

  it("should return an oauth2 type security scheme", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://example.clerk.accounts.dev",
    });

    expect(schemes.clerkOAuth.type).toBe("oauth2");
  });

  it("should include authorizationCode flow with the Clerk domain", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://example.clerk.accounts.dev",
    });

    const scheme = schemes.clerkOAuth;
    expect(scheme.type).toBe("oauth2");
    if (scheme.type !== "oauth2") throw new Error("Expected oauth2");

    const flow = scheme.flows.authorizationCode;
    expect(flow).toBeDefined();
    expect(flow?.authorizationUrl).toBe("https://example.clerk.accounts.dev/oauth/authorize");
    expect(flow?.tokenUrl).toBe("https://example.clerk.accounts.dev/oauth/token");
  });

  it("should use the provided clerk domain for OAuth URLs", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://my-app.clerk.accounts.dev",
    });

    const scheme = schemes.clerkOAuth;
    if (scheme.type !== "oauth2") throw new Error("Expected oauth2");

    const flow = scheme.flows.authorizationCode;
    expect(flow?.authorizationUrl).toBe("https://my-app.clerk.accounts.dev/oauth/authorize");
    expect(flow?.tokenUrl).toBe("https://my-app.clerk.accounts.dev/oauth/token");
  });

  it("should include description text", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://example.clerk.accounts.dev",
    });

    expect(schemes.clerkOAuth.description).toBeDefined();
    expect(typeof schemes.clerkOAuth.description).toBe("string");
  });

  it("should strip trailing slashes from the clerk domain", () => {
    const schemes = getClerkSecuritySchemes({
      clerkDomain: "https://example.clerk.accounts.dev/",
    });

    const scheme = schemes.clerkOAuth;
    if (scheme.type !== "oauth2") throw new Error("Expected oauth2");

    expect(scheme.flows.authorizationCode?.authorizationUrl).toBe(
      "https://example.clerk.accounts.dev/oauth/authorize"
    );
  });
});
