import { describe, expect, it } from "vitest";
import {
  applyCodeAfSpecToMetrics,
  codeAfHintDigest,
  defaultCodeAfSpec,
  extractJsonObject,
  normalizeCodeAfSpec,
} from "./index";

describe("pharmacist-kb Proof helpers", () => {
  it("normalize fills KB defaults and digest is stable", () => {
    const a = normalizeCodeAfSpec({ taper_step_ratio: 0.5 }, ["Nexium"]);
    const b = normalizeCodeAfSpec({ taper_step_ratio: 0.5 }, ["Nexium"]);
    expect(a.taper_step_ratio).toBe(0.5);
    expect(a.kb_rule_id.length).toBeGreaterThan(0);
    expect(codeAfHintDigest(a)).toBe(codeAfHintDigest(b));
  });

  it("same meds different taper_step_ratio changes at least one metric", () => {
    const base = {
      fallRiskBefore: 88,
      fallRiskAfter: 40,
      costDelta: 10000,
      riskDelta: 50,
      assistDelta: 500,
    };
    const low = applyCodeAfSpecToMetrics(base, {
      ...defaultCodeAfSpec(["Nexium"]),
      taper_step_ratio: 0.5,
    });
    const high = applyCodeAfSpecToMetrics(base, {
      ...defaultCodeAfSpec(["Nexium"]),
      taper_step_ratio: 1.0,
    });
    const changed =
      low.costDelta !== high.costDelta ||
      low.fallRiskAfter !== high.fallRiskAfter ||
      low.riskDelta !== high.riskDelta ||
      low.assistDelta !== high.assistDelta;
    expect(changed).toBe(true);
  });

  it("extractJsonObject strips markdown fences", () => {
    const raw = '```json\n{"taper_step_ratio":0.8,"kb_rule_id":["STOPP-B1"]}\n```';
    const o = extractJsonObject(raw);
    expect(o?.taper_step_ratio).toBe(0.8);
  });
});
