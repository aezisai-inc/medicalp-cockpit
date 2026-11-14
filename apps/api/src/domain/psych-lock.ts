import type { MedicationItem } from "./types";

/** Brand / INN / JP aliases that must stay LOCK (do not abrupt-stop). */
const HIGH_PSYCH_PATTERNS: RegExp[] = [
  /ジアゼパム|diazepam|セルシン|ホリゾン/i,
  /ブロチゾラム|brotizolam|レンドルミン/i,
  /ゾルピデム|zolpidem|マイスリー/i,
  /ロラゼパム|lorazepam|ワイパックス/i,
  /エチゾラム|etizolam|デパス|リーゼ/i,
  /アルプラゾラム|alprazolam|ソラナックス|コンスタン/i,
  /クロナゼパム|clonazepam|リボトリール|ランドセン/i,
  /フルニトラゼパム|flunitrazepam|サイレース|ロヒプノール/i,
  /フルラゼパム|flurazepam|ユーロジン/i,
  /トリアゾラム|triazolam|ハルシオン/i,
  /エスゾピクロン|eszopiclone|ルネスタ/i,
  /ゾピクロン|zopiclone|アモバン/i,
];

export function isHighPsychName(name: string): boolean {
  const n = String(name || "").trim();
  if (!n) return false;
  return HIGH_PSYCH_PATTERNS.some((re) => re.test(n));
}

/** Force HIGH + continue LOCK for known psychotropics (OCR-safe dictionary guard). */
export function enrichPsychLocks(meds: MedicationItem[]): MedicationItem[] {
  return meds.map((m) => {
    if (m.psychDependency === "HIGH" || isHighPsychName(m.name) || isHighPsychName(m.id)) {
      return {
        ...m,
        psychDependency: "HIGH",
        recommendation: "continue",
        active: true,
      };
    }
    return m;
  });
}

/** HIGH psych_dependency meds must stay active under AI batch. */
export function applyAiPlanPreservingPsychLocks(
  meds: MedicationItem[],
  proposed: MedicationItem[],
): MedicationItem[] {
  const byId = new Map(proposed.map((m) => [m.id, m]));
  return meds.map((m) => {
    if (m.psychDependency === "HIGH") {
      return { ...m, active: true, recommendation: "continue" };
    }
    const next = byId.get(m.id);
    return next ? { ...m, ...next, psychDependency: m.psychDependency } : m;
  });
}

/** OFF deprescribe candidates only (excludes HIGH + recommendation continue). */
export function medsEligibleForSavings(meds: MedicationItem[]): MedicationItem[] {
  return meds.filter(
    (m) =>
      m.psychDependency !== "HIGH" &&
      (m.recommendation === "stop" || m.recommendation === "taper") &&
      !m.active,
  );
}
