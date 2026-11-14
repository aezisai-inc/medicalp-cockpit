import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runDeprescribeSim } from "./daytona";
import type { MedicationItem } from "../domain/types";
import { defaultCodeAfSpec, codeAfHintDigest } from "../knowledge/pharmacist-kb";

const sample: MedicationItem[] = [
  {
    id: "ppi",
    name: "Nexium",
    usage: "15mg",
    recommendation: "stop",
    annualCost: 12000,
    riskWeight: 2,
    dosesPerDay: 1,
    active: false,
    psychDependency: "NONE",
    stepDown: [],
  },
];

describe("daytona Proof of Execution (fixture path)", () => {
  const prev = process.env.DAYTONA_API_KEY;

  beforeEach(() => {
    delete process.env.DAYTONA_API_KEY;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DAYTONA_API_KEY;
    else process.env.DAYTONA_API_KEY = prev;
  });

  it("consumes codeAfSpec: taper change alters metrics and digest matches", async () => {
    const lowSpec = { ...defaultCodeAfSpec(["Nexium"]), taper_step_ratio: 0.5 };
    const highSpec = { ...defaultCodeAfSpec(["Nexium"]), taper_step_ratio: 1.0 };
    const low = await runDeprescribeSim(sample, lowSpec);
    const high = await runDeprescribeSim(sample, highSpec);
    expect(low.codeAfHintDigest).toBe(codeAfHintDigest(lowSpec));
    expect(high.codeAfHintDigest).toBe(codeAfHintDigest(highSpec));
    expect(low.codeAfHintDigest).not.toBe(high.codeAfHintDigest);
    const changed =
      low.metrics.costDelta !== high.metrics.costDelta ||
      low.metrics.fallRiskAfter !== high.metrics.fallRiskAfter ||
      low.metrics.riskDelta !== high.metrics.riskDelta;
    expect(changed).toBe(true);
    expect(low.appliedKbRules?.length).toBeGreaterThan(0);
    expect(low.destroyProof.startsWith("destroyed:")).toBe(true);
  });
});
