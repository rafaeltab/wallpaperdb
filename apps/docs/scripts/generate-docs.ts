import { generateFiles } from "fumadocs-openapi";
import { assetOpenApi, ingestorOpenApi } from "../src/lib/openapi.ts";

void generateFiles({
  input: ingestorOpenApi,
  output: "./content/docs/openapi/ingestor",
  // we recommend to enable it
  // make sure your endpoint description doesn't break MDX syntax.
  includeDescription: true,
});

void generateFiles({
  input: assetOpenApi,
  output: "./content/docs/openapi/asset",
  // we recommend to enable it
  // make sure your endpoint description doesn't break MDX syntax.
  includeDescription: true,
});
