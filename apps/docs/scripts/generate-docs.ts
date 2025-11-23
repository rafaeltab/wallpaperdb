import { generateFiles } from "fumadocs-openapi";
import { openapi } from "../src/lib/openapi.ts";

void generateFiles({
  input: openapi,
  output: "./content/docs/openapi",
  // we recommend to enable it
  // make sure your endpoint description doesn't break MDX syntax.
  includeDescription: true,
});
