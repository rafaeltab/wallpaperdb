import { z } from "zod";
import { zodToJsonSchema } from "../utils/zod-to-json-schema.js";

/**
 * RFC 7807 Problem Details schema for HTTP APIs.
 * https://tools.ietf.org/html/rfc7807
 */
export const ProblemDetailsSchema = z
  .object({
    /** URI identifying the problem type (recommended, defaults to about:blank) */
    type: z.string().optional().describe("URI identifying the problem type"),
    /** Short, human-readable summary */
    title: z.string().optional().describe("Short, human-readable summary of the problem"),
    /** HTTP status code */
    status: z.number().int().min(100).max(599).optional().describe("HTTP status code"),
    /** Human-readable explanation specific to this occurrence */
    detail: z
      .string()
      .optional()
      .describe("Human-readable explanation specific to this occurrence of the problem"),
    /** URI of the endpoint that generated the error */
    instance: z.string().optional().describe("URI reference identifying the specific occurrence"),
  })
  .passthrough() // Allow extension fields
  .describe("RFC 7807 Problem Details response");

/**
 * Validation error detail for field-level errors.
 */
export const ValidationErrorDetailSchema = z.object({
  field: z.string().describe("Field that failed validation"),
  message: z.string().describe("Validation error message"),
  code: z.string().optional().describe("Error code for programmatic handling"),
});

/**
 * Extended Problem Details for validation errors (RFC 7807 extension).
 */
export const ValidationProblemDetailsSchema = ProblemDetailsSchema.extend({
  /** Array of validation errors */
  errors: z.array(ValidationErrorDetailSchema).optional().describe("Array of validation errors"),
});

// Export types inferred from schemas
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
export type ValidationErrorDetail = z.infer<typeof ValidationErrorDetailSchema>;
export type ValidationProblemDetails = z.infer<typeof ValidationProblemDetailsSchema>;

// Export JSON Schema versions for OpenAPI
export const ProblemDetailsJsonSchema = zodToJsonSchema(ProblemDetailsSchema, {
  name: "ProblemDetails",
});
export const ValidationProblemDetailsJsonSchema = zodToJsonSchema(ValidationProblemDetailsSchema, {
  name: "ValidationProblemDetails",
});
