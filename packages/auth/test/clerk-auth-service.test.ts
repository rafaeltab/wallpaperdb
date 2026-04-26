import { describe, it, expect } from "vitest";
import { ClerkAuthService } from "../src/clerk-auth-service.js";
import type { IAuthService } from "../src/i-auth-service.js";
import type { FastifyRequest } from "fastify";

function createMockRequestWithAuth(auth: { userId: string | null }): Partial<FastifyRequest> {
  return {
    auth: auth as unknown,
  } as Partial<FastifyRequest>;
}

describe("ClerkAuthService", () => {
  let service: IAuthService;

  beforeEach(() => {
    service = new ClerkAuthService();
  });

  it("should return User with id from request.auth.userId", () => {
    const request = createMockRequestWithAuth({
      userId: "user_2xKj9mN3pQ",
    }) as FastifyRequest;

    const result = service.getUser(request);

    expect(result).toEqual({ id: "user_2xKj9mN3pQ" });
  });

  it("should throw when userId is null and called without optional", () => {
    const request = createMockRequestWithAuth({
      userId: null,
    }) as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should return null when userId is null and called with optional: true", () => {
    const request = createMockRequestWithAuth({
      userId: null,
    }) as FastifyRequest;

    const result = service.getUser(request, { optional: true });

    expect(result).toBeNull();
  });

  it("should throw when auth is undefined and called without optional", () => {
    const request = { auth: undefined } as unknown as FastifyRequest;

    expect(() => service.getUser(request)).toThrow();
  });

  it("should return null when auth is undefined and called with optional: true", () => {
    const request = { auth: undefined } as unknown as FastifyRequest;

    const result = service.getUser(request, { optional: true });

    expect(result).toBeNull();
  });
});
