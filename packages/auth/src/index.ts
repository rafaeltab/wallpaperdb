export interface User {
  id: string;
}

export type { IAuthService } from "./i-auth-service.js";
export { IAuthServiceToken } from "./i-auth-service.js";
export { ClerkAuthService } from "./clerk-auth-service.js";
export { MockAuthService } from "./mock-auth-service.js";
export { registerAuth, type RegisterAuthOptions } from "./register-auth.js";

export interface ClerkSecuritySchemesOptions {
  clerkDomain: string;
}

export type { SecuritySchemes, SecurityScheme } from "@wallpaperdb/core/openapi";

export function getClerkSecuritySchemes(
  options: ClerkSecuritySchemesOptions
): Record<string, import("@wallpaperdb/core/openapi").SecurityScheme> {
  const { clerkDomain } = options;
  const normalizedDomain = clerkDomain.replace(/\/+$/, "");

  return {
    clerkOAuth: {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: `${normalizedDomain}/oauth/authorize`,
          tokenUrl: `${normalizedDomain}/oauth/token`,
          scopes: {},
        },
      },
      description:
        "Clerk OAuth2 authentication. Sign in via Clerk to obtain a JWT token for API access.",
    },
  };
}
