import { describe, expect, it } from "vitest";
import { assertNoPhiStrings, stripPhiDeep } from "./anonymize";

describe("anonymize AC-08", () => {
  it("redacts patientName and hospitalName", () => {
    const out = stripPhiDeep({
      patientName: "山田太郎",
      hospitalName: "さくら病院",
      meds: [{ name: "Amlodipine" }],
    });
    expect(out.patientName).toBe("[REDACTED]");
    expect(out.hospitalName).toBe("[REDACTED]");
    expect(out.meds[0].name).toBe("Amlodipine");
  });

  it("assertNoPhiStrings throws when forbidden remains", () => {
    expect(() => assertNoPhiStrings({ x: "山田太郎" }, ["山田太郎"])).toThrow(/PHI egress/);
  });
});
