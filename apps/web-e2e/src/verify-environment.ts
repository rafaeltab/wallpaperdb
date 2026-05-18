import { verifyWebE2EEnvironment } from "./environment-contract.ts";

try {
  await verifyWebE2EEnvironment(process.env);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
