import { describe, expect, it } from "vitest";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("returns resolved value when faster than ms", async () => {
    const v = await withTimeout(Promise.resolve("ok"), 1000, "fallback");
    expect(v).toBe("ok");
  });

  it("returns fallback when promise exceeds ms", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 200);
    });
    const v = await withTimeout(slow, 30, "fallback");
    expect(v).toBe("fallback");
  });

  it("returns fallback when promise rejects", async () => {
    const v = await withTimeout(
      Promise.reject(new Error("boom")),
      1000,
      "fallback",
    );
    expect(v).toBe("fallback");
  });
});
