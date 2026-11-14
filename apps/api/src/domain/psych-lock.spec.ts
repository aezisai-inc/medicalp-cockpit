import { describe, expect, it } from "vitest";
import {
  applyAiPlanPreservingPsychLocks,
  enrichPsychLocks,
  isHighPsychName,
  medsEligibleForSavings,
} from "./psych-lock";
import type { MedicationItem } from "./types";

const base = (over: Partial<MedicationItem>): MedicationItem => ({
  id: "m1",
  name: "Drug",
  usage: "1x",
  recommendation: "continue",
  annualCost: 10000,
  riskWeight: 1,
  dosesPerDay: 1,
  active: true,
  psychDependency: "NONE",
  stepDown: [],
  ...over,
});

describe("psych-lock AC-03", () => {
  it("keeps HIGH meds active under AI batch", () => {
    const meds = [
      base({ id: "sleep", name: "Z-drug", psychDependency: "HIGH" }),
      base({ id: "ppi", name: "PPI", psychDependency: "NONE" }),
    ];
    const proposed = [
      base({ id: "sleep", active: false, recommendation: "stop", psychDependency: "HIGH" }),
      base({ id: "ppi", active: false, recommendation: "stop" }),
    ];
    const out = applyAiPlanPreservingPsychLocks(meds, proposed);
    expect(out.find((m) => m.id === "sleep")?.active).toBe(true);
    expect(out.find((m) => m.id === "ppi")?.active).toBe(false);
  });

  it("detects JP/brand benzo aliases as HIGH", () => {
    expect(isHighPsychName("ジアゼパム錠 2mg")).toBe(true);
    expect(isHighPsychName("ブロチゾラムOD")).toBe(true);
    expect(isHighPsychName("Loxoprofen")).toBe(false);
  });

  it("enrichPsychLocks forces continue LOCK on benzos", () => {
    const out = enrichPsychLocks([
      base({
        id: "diazepam",
        name: "ジアゼパム錠 2mg 「サワイ」",
        recommendation: "stop",
        active: false,
        psychDependency: "NONE",
      }),
    ]);
    expect(out[0].psychDependency).toBe("HIGH");
    expect(out[0].recommendation).toBe("continue");
    expect(out[0].active).toBe(true);
  });

  it("excludes HIGH and continue from savings set", () => {
    const meds = [
      base({ id: "sleep", active: false, psychDependency: "HIGH", recommendation: "continue" }),
      base({ id: "keep", active: false, recommendation: "continue" }),
      base({ id: "ppi", active: false, recommendation: "stop" }),
    ];
    expect(medsEligibleForSavings(meds).map((m) => m.id)).toEqual(["ppi"]);
  });
});
