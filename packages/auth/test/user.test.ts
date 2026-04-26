import { describe, it, expect } from "vitest";
import type { User } from "../src/index.js";

describe("User", () => {
  it("should have an id field", () => {
    const user: User = { id: "user_123" };
    expect(user.id).toBe("user_123");
  });
});
