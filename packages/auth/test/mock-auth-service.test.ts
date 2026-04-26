import { describe, it, expect } from "vitest";
import { MockAuthService } from "../src/mock-auth-service.js";
import type { IAuthService } from "../src/i-auth-service.js";
import type { FastifyRequest } from "fastify";

function createMockRequest(authorization?: string): Partial<FastifyRequest> {
  return {
    headers: authorization ? { authorization } : {},
  };
}

describe("MockAuthService", () => {
  let service: IAuthService;

  beforeEach(() => {
    service = new MockAuthService();
  });

  it("should decode User from Authorization: Bearer <base64(JSON)>", () => {
    const user = { id: "user_test_001" };
    const encoded = Buffer.from(JSON.stringify(user)).toString("base64");
    const request = createMockRequest(`Bearer ${encoded}`) as FastifyRequest;

    const result = service.getUser(request);

    expect(result).toEqual({ id: "user_test_001" });
  });

  it("should throw when no auth header and called without optional", () => {
    const request = createMockRequest() as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should return null when no auth header and called with optional: true", () => {
    const request = createMockRequest() as FastifyRequest;

    const result = service.getUser(request, { optional: true });

    expect(result).toBeNull();
  });

  it("should throw when Authorization header has wrong scheme", () => {
    const user = { id: "user_test_001" };
    const encoded = Buffer.from(JSON.stringify(user)).toString("base64");
    const request = createMockRequest(`Basic ${encoded}`) as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should throw when Bearer token is not valid base64", () => {
    const request = createMockRequest("Bearer not-valid-base64!!!") as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should throw when Bearer token is valid base64 but not valid JSON", () => {
    const encoded = Buffer.from("not-json").toString("base64");
    const request = createMockRequest(`Bearer ${encoded}`) as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should throw when decoded JSON has no id field", () => {
    const encoded = Buffer.from(JSON.stringify({ name: "test" })).toString("base64");
    const request = createMockRequest(`Bearer ${encoded}`) as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });
});
