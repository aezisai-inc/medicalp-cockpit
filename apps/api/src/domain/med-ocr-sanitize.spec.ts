import { describe, expect, it } from "vitest";
import { sanitizeOcrMeds } from "./med-ocr-sanitize";
import type { MedicationItem } from "./types";

const base = (over: Partial<MedicationItem>): MedicationItem => ({
  id: "x",
  name: "Drug",
  usage: "1mg",
  recommendation: "continue",
  annualCost: 0,
  riskWeight: 0,
  dosesPerDay: 0,
  active: true,
  psychDependency: "NONE",
  stepDown: [],
  ...over,
});

describe("sanitizeOcrMeds", () => {
  it("drops clinic lines and fixes lorazepam 60mg → loxoprofen stop", () => {
    const out = sanitizeOcrMeds([
      base({ id: "cl", name: "メンタルＣＬ", usage: "2mg" }),
      base({ id: "lor", name: "ロラゼパム", usage: "60mg", recommendation: "continue" }),
      base({ id: "diaz", name: "ジアゼパム", usage: "0.25mg" }),
      base({ id: "amlo", name: "Amlodipine", usage: "2.5mg" }),
    ]);
    expect(out.some((m) => /メンタル/i.test(m.name))).toBe(false);
    const loxo = out.find((m) => /ロキソプロフェン/i.test(m.name));
    expect(loxo).toBeTruthy();
    expect(loxo?.recommendation).toBe("stop");
    expect(loxo?.psychDependency).toBe("NONE");
    expect(loxo?.annualCost).toBe(15600);
    expect(out.some((m) => /ロラゼパム/i.test(m.name))).toBe(false);
    expect(out.some((m) => m.name === "Amlodipine")).toBe(true);
    expect(out.some((m) => /ジアゼパム/i.test(m.name))).toBe(true);
  });
});
