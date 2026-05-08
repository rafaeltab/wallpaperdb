import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

import { buildWebE2EConfig } from "./src/playwright-config";

loadEnv({ path: new URL(".env", import.meta.url).pathname });

export default defineConfig(buildWebE2EConfig(process.env));
