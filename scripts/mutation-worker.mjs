import { writeFileSync } from "node:fs";
import { Stryker } from "@stryker-mutator/core";
await new Stryker({ configFile: process.argv[2] }).runMutationTest();
writeFileSync(process.argv[3], "complete");
