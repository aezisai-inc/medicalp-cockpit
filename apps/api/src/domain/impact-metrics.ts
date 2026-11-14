import type { MedicationItem } from "./types";

export type ImpactMetrics = {
  costBefore: number;
  costAfter: number;
  costDelta: number;
  assistDelta: number;
  fallRiskBefore: number;
  fallRiskAfter: number;
  riskDelta: number;
  /** Pitch: 1日4回服用ブロック → 朝1回集約 */
  dailyDosesBefore: number;
  dailyDosesAfter: number;
  /** Annual administration assists (4×365 → 1×365 at full deprescribe). */
  annualAssistsBefore: number;
  annualAssistsAfter: number;
  /** Fracture hospitalization avoided (万円・表示用; full pitch = 150). */
  fractureCostAvoidedMan: number;
};

const FALL_BEFORE = 88;
const FALL_SPAN = 70; // 88 → 18 when ratio = 1
const FALL_AFTER_FLOOR = 18;
const ASSIST_FULL = 1095;
const DAILY_DOSES_BEFORE = 4;
const DAILY_DOSES_AFTER_FULL = 1;
const ANNUAL_ASSISTS_BEFORE = 1460;
const ANNUAL_ASSISTS_AFTER_FULL = 365;
const FRACTURE_COST_AVOIDED_FULL_MAN = 150;

/**
 * Savings factor from recommendation.
 * HIGH: stop blocked (0); human taper → 0.5; continue → 0.
 * NONE: stop → 1.0; taper → 0.5; continue → 0.
 */
export function savingsFactor(
  m: Pick<MedicationItem, "recommendation" | "psychDependency">,
): number {
  const rec = m.recommendation;
  if (rec === "continue") return 0;
  if (m.psychDependency === "HIGH") {
    if (rec === "taper") return 0.5;
    return 0;
  }
  if (rec === "stop") return 1;
  if (rec === "taper") return 0.5;
  return 0;
}

export function medSavings(
  m: Pick<MedicationItem, "annualCost" | "recommendation" | "psychDependency">,
): number {
  return (m.annualCost || 0) * savingsFactor(m);
}

/** Pool of meds currently contributing deprescribe savings. */
export function medsSavingsPool(meds: MedicationItem[]): MedicationItem[] {
  return meds.filter((m) => savingsFactor(m) > 0);
}

/**
 * Impact meters from recommendation SoT.
 * Pitch: stop4 + taper2 factors → costDelta 68400 when fixture costs synced.
 */
export function computeImpactMetrics(meds: MedicationItem[]): ImpactMetrics {
  const costBefore = meds.reduce((s, m) => s + (m.annualCost || 0), 0);
  const costDelta = Math.round(meds.reduce((s, m) => s + medSavings(m), 0));
  const costAfter = Math.max(0, costBefore - costDelta);

  // Reference capacity: non-HIGH stop|taper at their factors + HIGH taper.
  // When AI plan applied, capacity == costDelta → ratio 1 → fallRiskAfter 18.
  const capacity = meds.reduce((s, m) => {
    if (m.psychDependency === "HIGH") {
      // capacity includes possible human taper even if still continue
      return s + (m.annualCost || 0) * 0.5;
    }
    if (m.recommendation === "stop" || m.recommendation === "taper") {
      return s + (m.annualCost || 0) * (m.recommendation === "stop" ? 1 : 0.5);
    }
    return s;
  }, 0);

  // Prefer deprescribe-pool capacity (excludes HIGH continue capacity) for pitch ratio.
  const poolCapacity = meds.reduce((s, m) => {
    if (m.psychDependency === "HIGH") {
      return m.recommendation === "taper" ? s + (m.annualCost || 0) * 0.5 : s;
    }
    if (m.recommendation === "stop") return s + (m.annualCost || 0);
    if (m.recommendation === "taper") return s + (m.annualCost || 0) * 0.5;
    return s;
  }, 0);

  const maxCost = poolCapacity > 0 ? poolCapacity : capacity;
  let ratio = maxCost > 0 ? Math.min(1, Math.max(0, costDelta / maxCost)) : 0;
  // OCR meds often lack annualCost → costDelta=0. Fall back to stop/taper dose share.
  if (ratio === 0 && meds.length > 0 && costBefore === 0) {
    const doseBefore = meds.reduce((s, m) => s + (m.dosesPerDay || 1), 0);
    const doseSaved = meds.reduce((s, m) => {
      const d = m.dosesPerDay || 1;
      return s + d * savingsFactor(m);
    }, 0);
    ratio =
      doseBefore > 0 ? Math.min(1, Math.max(0, doseSaved / doseBefore)) : 0;
  }
  const fallRiskBefore = FALL_BEFORE;
  const fallRiskAfter = Math.min(
    FALL_BEFORE,
    Math.max(FALL_AFTER_FLOOR, Math.round(FALL_BEFORE - FALL_SPAN * ratio)),
  );
  const dailyDosesAfter = Math.round(
    DAILY_DOSES_BEFORE - (DAILY_DOSES_BEFORE - DAILY_DOSES_AFTER_FULL) * ratio,
  );
  const annualAssistsAfter = Math.round(
    ANNUAL_ASSISTS_BEFORE - (ANNUAL_ASSISTS_BEFORE - ANNUAL_ASSISTS_AFTER_FULL) * ratio,
  );
  return {
    costBefore,
    costAfter,
    costDelta,
    assistDelta: Math.round(ASSIST_FULL * ratio),
    fallRiskBefore,
    fallRiskAfter,
    riskDelta: fallRiskBefore - fallRiskAfter,
    dailyDosesBefore: DAILY_DOSES_BEFORE,
    dailyDosesAfter,
    annualAssistsBefore: ANNUAL_ASSISTS_BEFORE,
    annualAssistsAfter,
    fractureCostAvoidedMan: Math.round(FRACTURE_COST_AVOIDED_FULL_MAN * ratio),
  };
}
