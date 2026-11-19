import { mergeReceipts as merge } from "../../packages/coverage-runtime/dist/receipts.mjs";
import { estimates } from "../coverage-policy.mts";
export { hash, revision, writeReceipt } from "../../packages/coverage-runtime/dist/receipts.mjs";
export const mergeReceipts = (root, expected, directory, output) => merge(root, expected, directory, output, estimates);
