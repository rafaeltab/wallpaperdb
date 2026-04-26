import "reflect-metadata";
import type { FastifyInstance } from "fastify";
import { container } from "tsyringe";
import { IAuthServiceToken } from "./i-auth-service.js";
import type { IAuthService } from "./i-auth-service.js";
import { ClerkAuthService } from "./clerk-auth-service.js";
import { MockAuthService } from "./mock-auth-service.js";

export interface RegisterAuthOptions {
  secretKey?: string;
  testMode?: boolean;
}

interface RouteConfigWithAuth {
  skipAuth?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      userId: string | null;
      [key: string]: unknown;
    };
  }
}

export async function registerAuth(
  app: FastifyInstance,
  options: RegisterAuthOptions
): Promise<void> {
  const { secretKey, testMode = false } = options;

  if (testMode) {
    container.register(IAuthServiceToken, { useClass: MockAuthService });
  } else {
    container.register(IAuthServiceToken, { useClass: ClerkAuthService });
  }

  const authService = container.resolve<IAuthService>(IAuthServiceToken);

  if (!testMode) {
    const { clerkPlugin } = await import("@clerk/fastify");
    await app.register(clerkPlugin, { secretKey });
  }

  app.addHook("onRequest", async (request, reply) => {
    const routeConfig = request.routeOptions.config as RouteConfigWithAuth | undefined;
    if (routeConfig?.skipAuth) {
      return;
    }

    const user = authService.getUser(request, { optional: true });

    if (!user) {
      return reply.code(401).header("content-type", "application/problem+json").send({
        type: "https://wallpaperdb.example/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Authentication is required to access this resource.",
        instance: request.url,
      });
    }
  });
}
