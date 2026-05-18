import { config as loadEnv } from "dotenv";

import { verifyWebE2EEnvironment } from "./environment-contract.ts";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

try {
  await verifyWebE2EEnvironment(process.env);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
