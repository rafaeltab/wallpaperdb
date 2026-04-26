import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { container } from "tsyringe";
import { registerAuth } from "../src/register-auth.js";
import { IAuthServiceToken } from "../src/i-auth-service.js";
import type { IAuthService } from "../src/i-auth-service.js";
import { MockAuthService } from "../src/mock-auth-service.js";

describe("registerAuth", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("testMode", () => {
    it("should register MockAuthService as IAuthService", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      const authService = container.resolve<IAuthService>(IAuthServiceToken);
      expect(authService).toBeInstanceOf(MockAuthService);
    });

    it("should authenticate requests with valid Bearer token", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      app.get("/protected", async (request, reply) => {
        const authService = container.resolve<IAuthService>(IAuthServiceToken);
        const user = authService.getUser(request);
        return reply.send({ userId: user.id });
      });

      const user = { id: "user_test_001" };
      const encoded = Buffer.from(JSON.stringify(user)).toString("base64");

      const response = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${encoded}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ userId: "user_test_001" });
    });

    it("should return 401 Problem Details for unauthenticated request", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      app.get("/protected", async (request, reply) => {
        const authService = container.resolve<IAuthService>(IAuthServiceToken);
        const user = authService.getUser(request);
        return reply.send({ userId: user.id });
      });

      const response = await app.inject({
        method: "GET",
        url: "/protected",
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.type).toBeDefined();
      expect(body.title).toBeDefined();
      expect(body.status).toBe(401);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    });

    it("should allow routes with skipAuth to be accessible without auth", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      app.get("/health", { config: { skipAuth: true } }, async (_request, reply) => {
        return reply.send({ status: "ok" });
      });

      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    });

    it("should allow optional auth on skipAuth routes", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      app.get("/public", { config: { skipAuth: true } }, async (request, reply) => {
        const authService = container.resolve<IAuthService>(IAuthServiceToken);
        const user = authService.getUser(request, { optional: true });
        return reply.send({ userId: user?.id ?? null });
      });

      const user = { id: "user_test_001" };
      const encoded = Buffer.from(JSON.stringify(user)).toString("base64");

      const responseWithAuth = await app.inject({
        method: "GET",
        url: "/public",
        headers: { authorization: `Bearer ${encoded}` },
      });

      expect(responseWithAuth.statusCode).toBe(200);
      expect(responseWithAuth.json()).toEqual({ userId: "user_test_001" });

      const responseWithoutAuth = await app.inject({
        method: "GET",
        url: "/public",
      });

      expect(responseWithoutAuth.statusCode).toBe(200);
      expect(responseWithoutAuth.json()).toEqual({ userId: null });
    });

    it("should not register @clerk/fastify in testMode", async () => {
      await registerAuth(app, { secretKey: "test", testMode: true });

      expect(app.hasDecorator("auth")).toBe(false);
    });
  });
});
