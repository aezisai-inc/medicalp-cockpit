/** FE mirror of apps/api/src/domain/impact-metrics.ts (no shared package in PoC). */

export type MedLike = {
  annualCost: number;
  active: boolean;
  psychDependency: "NONE" | "HIGH";
  recommendation?: string;
  dosesPerDay?: number;
};

export type ImpactMetrics = {
  costBefore: number;
  costAfter: number;
  costDelta: number;
  assistDelta: number;
  fallRiskBefore: number;
  fallRiskAfter: number;
  riskDelta: number;
  dailyDosesBefore: number;
  dailyDosesAfter: number;
  annualAssistsBefore: number;
  annualAssistsAfter: number;
  fractureCostAvoidedMan: number;
};

const FALL_BEFORE = 88;
const FALL_SPAN = 70;
const FALL_AFTER_FLOOR = 18;
const ASSIST_FULL = 1095;
const DAILY_DOSES_BEFORE = 4;
const DAILY_DOSES_AFTER_FULL = 1;
const ANNUAL_ASSISTS_BEFORE = 1460;
const ANNUAL_ASSISTS_AFTER_FULL = 365;
const FRACTURE_COST_AVOIDED_FULL_MAN = 150;

export function savingsFactor(m: MedLike): number {
  const rec = (m.recommendation || "continue").toLowerCase();
  if (rec === "continue") return 0;
  if (m.psychDependency === "HIGH") {
    if (rec === "taper") return 0.5;
    return 0;
  }
  if (rec === "stop") return 1;
  if (rec === "taper") return 0.5;
  return 0;
}

/** Derive active from recommendation; HIGH may taper (active false) but never stop. */
export function applyRecommendationActives<T extends MedLike>(meds: T[]): T[] {
  return meds.map((m) => {
    let rec = (m.recommendation || "continue").toLowerCase();
    if (m.psychDependency === "HIGH" && rec === "stop") rec = "continue";
    const factor = savingsFactor({ ...m, recommendation: rec });
    return {
      ...m,
      recommendation: rec,
      active: factor === 0,
    };
  });
}

export function computeImpactMetrics(meds: MedLike[]): ImpactMetrics {
  const costBefore = meds.reduce((s, m) => s + (m.annualCost || 0), 0);
  const costDelta = Math.round(
    meds.reduce((s, m) => s + (m.annualCost || 0) * savingsFactor(m), 0),
  );
  const costAfter = Math.max(0, costBefore - costDelta);
  const poolCapacity = meds.reduce((s, m) => {
    const f = savingsFactor(m);
    return f > 0 ? s + (m.annualCost || 0) * f : s;
  }, 0);
  const maxCost = poolCapacity;
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
