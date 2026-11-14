import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { stripPhiDeep } from "./anonymize";

describe("anonymize PBT AC-08", () => {
  it("always redacts patientName field", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (name) => {
        const out = stripPhiDeep({ patientName: name, ok: true });
        expect(out.patientName).toBe("[REDACTED]");
        expect(out.ok).toBe(true);
      }),
    );
  });
});
