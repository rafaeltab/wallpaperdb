import { createOpenAPI } from "fumadocs-openapi/server";

export const ingestorOpenApi = createOpenAPI({
  // the OpenAPI schema, you can also give it an external URL.
  input: ["../ingestor/swagger.json"],
});

export const assetOpenApi = createOpenAPI({
  // the OpenAPI schema, you can also give it an external URL.
  input: ["../asset/swagger.json"],
});

export const wallpaperOpenApi = createOpenAPI({
  input: ["../wallpaper/swagger.json"],
});
