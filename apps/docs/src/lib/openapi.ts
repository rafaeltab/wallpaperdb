import { createOpenAPI } from "fumadocs-openapi/server";

export const ingestorOpenApi = createOpenAPI({
    // the OpenAPI schema, you can also give it an external URL.
    input: ["../ingestor/swagger.json"],
});

export const mediaOpenApi = createOpenAPI({
    // the OpenAPI schema, you can also give it an external URL.
    input: ["../media/swagger.json"],
});
