import type { FastifyRequest } from "fastify";
import type { IAuthService } from "./i-auth-service.js";
import type { User } from "./index.js";

interface RequestWithAuth {
  auth?: { userId: string | null; [key: string]: unknown };
}

export class ClerkAuthService implements IAuthService {
  getUser(request: FastifyRequest): User;
  getUser(request: FastifyRequest, options: { optional: true }): User | null;
  getUser(request: FastifyRequest, options?: { optional: true }): User | null {
    const auth = (request as unknown as RequestWithAuth).auth;

    if (!auth || !auth.userId) {
      if (options?.optional) {
        return null;
      }
      throw new Error("No authenticated user");
    }

    return { id: auth.userId };
  }
}
