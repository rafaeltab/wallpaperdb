export interface User {
  id: string;
}

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
