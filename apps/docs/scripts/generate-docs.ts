import { generateFiles } from "fumadocs-openapi";
import { ingestorOpenApi, mediaOpenApi } from "../src/lib/openapi.ts";

void generateFiles({
    input: ingestorOpenApi,
    output: "./content/docs/openapi/ingestor",
    // we recommend to enable it
    // make sure your endpoint description doesn't break MDX syntax.
    includeDescription: true,
});

void generateFiles({
    input: mediaOpenApi,
    output: "./content/docs/openapi/media",
    // we recommend to enable it
    // make sure your endpoint description doesn't break MDX syntax.
    includeDescription: true,
});
