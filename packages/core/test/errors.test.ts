import { describe, it, expect } from "vitest";
import {
  ProblemDetailsError,
  ApplicationError,
  InternalError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from "../src/errors/index.js";

class TestProblemError extends ProblemDetailsError {
  readonly type = "https://example.com/problems/test";
  readonly title = "Test Error";
  readonly status = 400;
  readonly instance = "/test";
}

describe("ProblemDetailsError", () => {
  it("should create error with required fields", () => {
    const error = new TestProblemError("Something went wrong");

    expect(error.type).toBe("https://example.com/problems/test");
    expect(error.title).toBe("Test Error");
    expect(error.status).toBe(400);
    expect(error.instance).toBe("/test");
    expect(error.detail).toBe("Something went wrong");
    expect(error.message).toBe("Something went wrong");
  });

  it("should include extensions in toJSON", () => {
    const error = new TestProblemError("Error", { customField: "value" });
    const json = error.toJSON();

    expect(json.type).toBe("https://example.com/problems/test");
    expect(json.title).toBe("Test Error");
    expect(json.status).toBe(400);
    expect(json.detail).toBe("Error");
    expect(json.instance).toBe("/test");
    expect(json.customField).toBe("value");
  });

  it("should be an instance of Error", () => {
    const error = new TestProblemError("Error");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProblemDetailsError);
  });
});

describe("ApplicationError", () => {
  describe("InternalError", () => {
    it("should have correct code and status", () => {
      const error = new InternalError("Internal error occurred");

      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe("Internal error occurred");
    });
  });

  describe("NotFoundError", () => {
    it("should have correct code and status", () => {
      const error = new NotFoundError("Resource not found");

      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("ValidationError", () => {
    it("should have correct code and status", () => {
      const error = new ValidationError("Invalid input");

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
    });
  });

  describe("UnauthorizedError", () => {
    it("should have correct code and status", () => {
      const error = new UnauthorizedError("Not authenticated");

      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.statusCode).toBe(401);
    });
  });

  describe("ForbiddenError", () => {
    it("should have correct code and status", () => {
      const error = new ForbiddenError("Access denied");

      expect(error.code).toBe("FORBIDDEN");
      expect(error.statusCode).toBe(403);
    });
  });

  describe("ConflictError", () => {
    it("should have correct code and status", () => {
      const error = new ConflictError("Resource already exists");

      expect(error.code).toBe("CONFLICT");
      expect(error.statusCode).toBe(409);
    });
  });

  it("should include context in toJSON", () => {
    const error = new InternalError("Error", { userId: "123" });
    const json = error.toJSON();

    expect(json.name).toBe("InternalError");
    expect(json.code).toBe("INTERNAL_ERROR");
    expect(json.message).toBe("Error");
    expect(json.statusCode).toBe(500);
    expect(json.context).toEqual({ userId: "123" });
  });

  it("should be an instance of Error", () => {
    const error = new InternalError("Error");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApplicationError);
  });
});
