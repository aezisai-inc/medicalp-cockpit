import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeImpactMetrics, medsSavingsPool, savingsFactor } from "./impact-metrics";
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

describe("computeImpactMetrics", () => {
  it("all continue → cost 0, after 88, assist 0", () => {
    const meds = [
      base({ id: "a", annualCost: 30000, recommendation: "continue" }),
      base({ id: "b", annualCost: 38400, recommendation: "continue" }),
      base({ id: "z", annualCost: 22000, psychDependency: "HIGH", recommendation: "continue" }),
    ];
    const m = computeImpactMetrics(meds);
    expect(m.costDelta).toBe(0);
    expect(m.costBefore).toBe(90400);
    expect(m.costAfter).toBe(90400);
    expect(m.assistDelta).toBe(0);
    expect(m.fallRiskAfter).toBe(88);
    expect(m.dailyDosesBefore).toBe(4);
    expect(m.dailyDosesAfter).toBe(4);
    expect(m.annualAssistsBefore).toBe(1460);
    expect(m.annualAssistsAfter).toBe(1460);
    expect(m.fractureCostAvoidedMan).toBe(0);
  });

  it("stop 1.0 + taper 0.5 → full pitch meters; HIGH continue ignored", () => {
    const meds = [
      base({ id: "a", annualCost: 30000, recommendation: "stop", active: false }),
      base({ id: "b", annualCost: 76800, recommendation: "taper", active: false }),
      base({ id: "c", annualCost: 12000, recommendation: "continue", active: true }),
      base({
        id: "z",
        annualCost: 22000,
        psychDependency: "HIGH",
        recommendation: "continue",
        active: true,
      }),
    ];
    // 30000 + 0.5*76800 = 30000+38400 = 68400
    expect(medsSavingsPool(meds).map((x) => x.id).sort()).toEqual(["a", "b"]);
    const m = computeImpactMetrics(meds);
    expect(m.costDelta).toBe(68400);
    expect(m.assistDelta).toBe(1095);
    expect(m.fallRiskBefore).toBe(88);
    expect(m.fallRiskAfter).toBe(18);
    expect(m.costAfter).toBe(m.costBefore - 68400);
    expect(m.dailyDosesAfter).toBe(1);
    expect(m.annualAssistsAfter).toBe(365);
    expect(m.fractureCostAvoidedMan).toBe(150);
  });

  it("HIGH human taper contributes 0.5; HIGH stop factor 0", () => {
    expect(savingsFactor(base({ psychDependency: "HIGH", recommendation: "stop" }))).toBe(0);
    expect(savingsFactor(base({ psychDependency: "HIGH", recommendation: "taper" }))).toBe(0.5);
    const meds = [
      base({
        id: "z",
        annualCost: 20000,
        psychDependency: "HIGH",
        recommendation: "taper",
        active: false,
      }),
    ];
    const m = computeImpactMetrics(meds);
    expect(m.costDelta).toBe(10000);
  });



  it("souvenir fixture: 3 clinics A/B/C on nine meds", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "../../../../fixtures/resident-souvenir-v1.json"), "utf8"),
    ) as { meds: MedicationItem[] };
    const clinics = new Set(raw.meds.map((m) => m.clinic));
    expect(clinics).toEqual(new Set(["A整形外科", "B内科", "CメンタルCL"]));
    expect(raw.meds.filter((m) => m.clinic === "A整形外科")).toHaveLength(3);
    expect(raw.meds.filter((m) => m.clinic === "B内科")).toHaveLength(3);
    expect(raw.meds.filter((m) => m.clinic === "CメンタルCL")).toHaveLength(3);
  });

  it("souvenir AI plan: stop4+taper2 → 68400 / 18 / 1095", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "../../../../fixtures/resident-souvenir-v1.json"), "utf8"),
    ) as { meds: MedicationItem[] };
    const planned = raw.meds.map((m) => {
      if (m.psychDependency === "HIGH") {
        return { ...m, active: true, recommendation: "continue" as const };
      }
      const off = m.recommendation === "stop" || m.recommendation === "taper";
      return { ...m, active: !off };
    });
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of planned) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 2, continue: 3 });
    const m = computeImpactMetrics(planned);
    expect(m.costDelta).toBe(68400);
    expect(m.fallRiskAfter).toBe(18);
    expect(m.assistDelta).toBe(1095);
    expect(m.dailyDosesBefore).toBe(4);
    expect(m.dailyDosesAfter).toBe(1);
    expect(m.annualAssistsBefore).toBe(1460);
    expect(m.annualAssistsAfter).toBe(365);
    expect(m.fractureCostAvoidedMan).toBe(150);
  });
});
