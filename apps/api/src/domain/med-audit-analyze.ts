import type { MedicationItem, ResidentCase } from "./types";

function normBlob(m: MedicationItem): string {
  return `${m.name} ${m.id}`.toLowerCase().replace(/\s+/g, "");
}

function matchesAny(blob: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(blob));
}

/** English souvenir fixture rows (vision OCR labels). */
function souvenirEnglishPitch(name: string): MedicationItem["recommendation"] | null {
  const n = name.trim().toLowerCase();
  if (n === "furosemide") return "stop";
  if (n.includes("lansoprazole")) return "taper";
  if (n.includes("magnesium")) return "taper";
  if (n.includes("rebamipide")) return "stop";
  if (n.includes("aspirin")) return "stop";
  if (n.includes("vitamin d")) return "stop";
  if (n.includes("amlodipine")) return "continue";
  return null;
}

const STOP_PATTERNS = [
  /メチコバール/,
  /ミオナール/,
  /ガスモチン/,
  /ネキシウム|nexium/,
  /オメプラゾール|omeprazole/,
  /ランソプラゾール/,
  /ロキソ|loxoprofen/,
  /レバミピド|rebamipide/,
  /アスピリン|aspirin/,
  /ビタミン\s*d|vitamin\s*d/,
];

const TAPER_PATTERNS = [/フロセミド|furosemide/, /ランソプラゾール|lansoprazole/, /マグネシウム|magnesium/];

const CONTINUE_PATTERNS = [/アムロジピン|amlodipine/, /リピトール|アトルバスタチン|lipitor|atorvastatin/];

/** Scan phase: every row is continue + active. */
export function forceContinueBaseline(meds: MedicationItem[]): MedicationItem[] {
  return meds.map((m) => ({
    ...m,
    recommendation: "continue" as const,
    active: true,
  }));
}

function resolveRecommendation(m: MedicationItem): MedicationItem["recommendation"] {
  if (m.psychDependency === "HIGH") return "continue";
  const souvenir = souvenirEnglishPitch(m.name);
  if (souvenir) return souvenir;
  const blob = normBlob(m);
  if (matchesAny(blob, STOP_PATTERNS)) return "stop";
  if (matchesAny(blob, TAPER_PATTERNS)) return "taper";
  if (matchesAny(blob, CONTINUE_PATTERNS)) return "continue";
  return "continue";
}

/** Audit-phase deprescribe pitch (after scan all-continue baseline). */
export function analyzeMedsForAudit(
  meds: MedicationItem[],
  _case?: ResidentCase,
): MedicationItem[] {
  return meds.map((m) => {
    const recommendation = resolveRecommendation(m);
    const off = recommendation === "stop" || recommendation === "taper";
    return {
      ...m,
      recommendation,
      active: m.psychDependency === "HIGH" ? true : !off,
    };
  });
}
