import { describe, expect, it } from "vitest";
import type { MedicationItem } from "./types";
import { analyzeMedsForAudit, forceContinueBaseline } from "./med-audit-analyze";

function med(partial: Partial<MedicationItem> & Pick<MedicationItem, "id" | "name">): MedicationItem {
  return {
    usage: "1日1回",
    active: true,
    psychDependency: "NONE",
    annualCost: 12000,
    recommendation: "continue",
    ...partial,
  };
}

describe("forceContinueBaseline", () => {
  it("marks every med continue + active", () => {
    const input = [
      med({ id: "a", name: "アスピリン", recommendation: "stop", active: false }),
      med({ id: "b", name: "アムロジピン", recommendation: "taper", active: false }),
    ];
    const out = forceContinueBaseline(input);
    expect(out.every((m) => m.recommendation === "continue" && m.active)).toBe(true);
  });
});

describe("analyzeMedsForAudit", () => {
  it("fixture souvenir pitch stop4 taper2 continue3", () => {
    const fixture = [
      med({ id: "amlodipine", name: "Amlodipine" }),
      med({ id: "lansoprazole", name: "Lansoprazole" }),
      med({ id: "zolpidem", name: "Zolpidem", psychDependency: "HIGH" }),
      med({ id: "furosemide", name: "Furosemide" }),
      med({ id: "magnesium", name: "Magnesium oxide" }),
      med({ id: "rebamipide", name: "Rebamipide" }),
      med({ id: "aspirin", name: "Aspirin" }),
      med({ id: "lorazepam", name: "Lorazepam", psychDependency: "HIGH" }),
      med({ id: "vitd", name: "Vitamin D" }),
    ];
    const out = analyzeMedsForAudit(forceContinueBaseline(fixture));
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of out) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 2, continue: 3 });
  });

  it("3-med live fixture: HIGH lorazepam continue, omeprazole stop", () => {
    const three = [
      med({ id: "lorazepam", name: "ロラゼパム", psychDependency: "HIGH" }),
      med({ id: "amlodipine", name: "アムロジピン錠5mg" }),
      med({ id: "omeprazole", name: "オメプラゾール錠10mg" }),
    ];
    const out = analyzeMedsForAudit(forceContinueBaseline(three));
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(byId.lorazepam.recommendation).toBe("continue");
    expect(byId.lorazepam.active).toBe(true);
    expect(byId.amlodipine.recommendation).toBe("continue");
    expect(byId.omeprazole.recommendation).toBe("stop");
    expect(byId.omeprazole.active).toBe(false);
    expect(out.filter((m) => m.recommendation === "stop").length).toBeGreaterThanOrEqual(1);
  });

  it("8-med JP pattern stop4 taper1 continue3", () => {
    const eight = [
      med({ id: "m1", name: "メチコバール錠500mg" }),
      med({ id: "m2", name: "ミオナール錠10mg" }),
      med({ id: "m3", name: "ガスモチン錠5mg" }),
      med({ id: "m4", name: "ネキシウムカプセル20mg" }),
      med({ id: "m5", name: "フロセミド錠20mg" }),
      med({ id: "m6", name: "アムロジピン錠5mg" }),
      med({ id: "m7", name: "リピトール錠10mg" }),
      med({ id: "m8", name: "コンドロイチン硫酸錠" }),
    ];
    const out = analyzeMedsForAudit(forceContinueBaseline(eight));
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of out) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 1, continue: 3 });
  });
});
