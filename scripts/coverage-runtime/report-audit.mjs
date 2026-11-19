import { auditReports as audit } from "../../packages/coverage-runtime/dist/report-audit.mjs";
import { estimates } from "../coverage-policy.mts";
export const auditReports = (inputs, root) => audit(inputs, root, estimates);
