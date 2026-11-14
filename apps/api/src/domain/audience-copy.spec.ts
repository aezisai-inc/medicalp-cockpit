import { describe, expect, it } from "vitest";
import { FAMILY_FORBIDDEN, projectAudienceCopy } from "./audience-copy";
import type { MedicationItem } from "./types";

const med: MedicationItem = {
  id: "sleep",
  name: "Z",
  usage: "1",
  recommendation: "continue",
  annualCost: 1,
  riskWeight: 1,
  dosesPerDay: 1,
  active: true,
  psychDependency: "HIGH",
  stepDown: [],
};

describe("audience-copy AC-04/05", () => {
  it("family mode has zero forbidden lexicon and lock promise", () => {
    const { displayText, family } = projectAudienceCopy(
      "family",
      [med],
      "ぶった斬りで老健利益・100床 ROI",
    );
    for (const w of FAMILY_FORBIDDEN) {
      expect(displayText.includes(w)).toBe(false);
    }
    expect(displayText).toMatch(/急に止め/);
    expect(family?.gentleGraduationTitle).toBeTruthy();
  });
});
