import type { FastifyRequest } from "fastify";
import type { User } from "./index.js";

export interface IAuthService {
  getUser(request: FastifyRequest): User;
  getUser(request: FastifyRequest, options: { optional: true }): User | null;
}

export const IAuthServiceToken = "IAuthService" as const;
