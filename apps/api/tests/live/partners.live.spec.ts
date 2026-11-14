import { describe, expect, it } from "vitest";
import { searchEvidence } from "../../src/partners/tavily";
import { runDeprescribeSim } from "../../src/partners/daytona";
import { isChatCompletionsUrl } from "../../src/partners/openai-compat";
import type { MedicationItem } from "../../src/domain/types";

const sample: MedicationItem[] = [
  {
    id: "ppi",
    name: "PPI",
    usage: "15mg",
    recommendation: "stop",
    annualCost: 1000,
    riskWeight: 1,
    dosesPerDay: 1,
    active: false,
    psychDependency: "NONE",
    stepDown: [],
  },
];

describe("partners live-or-labeled", () => {
  it("detects OpenAI chat completions URLs", () => {
    expect(
      isChatCompletionsUrl("https://openrouter.ai/api/v1/chat/completions"),
    ).toBe(true);
    expect(
      isChatCompletionsUrl(
        "https://job.node.k8s.prd.nos.ci/v1/chat/completions",
      ),
    ).toBe(true);
    expect(isChatCompletionsUrl("https://cp.example/api/v1/agents/run")).toBe(
      false,
    );
  });

  it("Tavily returns hits with explicit source", async () => {
    const r = await searchEvidence("deprescribing elderly");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(["live", "fixture", "live-cache"]).toContain(r.source);
    if (process.env.TAVILY_API_KEY) {
      expect(r.source).toBe("live");
    } else {
      expect(["live-cache", "fixture"]).toContain(r.source);
    }
  });

  it("Daytona sim returns destroy proof with explicit source", async () => {
    const r = await runDeprescribeSim(sample);
    expect(r.destroyProof).toMatch(/destroyed/);
    expect(["live", "fixture", "live-cache"]).toContain(r.source);
    if (process.env.DAYTONA_API_KEY) {
      expect(r.source).toBe("live");
      expect(r.destroyProof).not.toMatch(/fixture-sandbox|sbx-pitch-seed/);
    } else {
      expect(r.source).toBe("live-cache");
      expect(r.destroyProof).not.toBe("destroyed:fixture-sandbox");
    }
  }, 60_000);
});
