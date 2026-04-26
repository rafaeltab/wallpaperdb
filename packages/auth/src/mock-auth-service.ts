import type { FastifyRequest } from "fastify";
import type { IAuthService } from "./i-auth-service.js";
import type { User } from "./index.js";

export class MockAuthService implements IAuthService {
  getUser(request: FastifyRequest): User;
  getUser(request: FastifyRequest, options: { optional: true }): User | null;
  getUser(request: FastifyRequest, options?: { optional: true }): User | null {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      if (options?.optional) {
        return null;
      }
      throw new Error("No authentication provided");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      throw new Error("Invalid authorization scheme");
    }

    const encoded = parts[1];
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
      throw new Error("Invalid base64 encoding in authorization header");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error("Invalid JSON in authorization header");
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      typeof (parsed as Record<string, unknown>).id !== "string"
    ) {
      throw new Error("Invalid user object in authorization header");
    }

    return parsed as User;
  }
}
