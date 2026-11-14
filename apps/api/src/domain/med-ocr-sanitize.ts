import type { MedicationItem } from "./types";

/** Facility / meta lines that must never become meds (ASCII + fullwidth CL). */
const NON_DRUG_NAME =
  /クリニック|メンタル\s*[ＣC]?[ＬL]|病院|薬局|医院|診療所|先生|様|TEL|〒|フォア|ウエルシア|マツモトキヨシ|処方せん|調剤/i;

/** Known INN / brand aliases that count as drugs even without 錠. */
const KNOWN_DRUG =
  /ジアゼパム|diazepam|ブロチゾラム|brotizolam|ロキソプロフェン|loxoprofen|オロパタジン|olopatadine|アムロジピン|amlodipine|ゾルピデム|zolpidem|ロラゼパム|lorazepam|ランソプラゾール|lansoprazole|フロセミド|furosemide|アスピリン|aspirin|マグネシウム|magnesium|レバミピド|rebamipide|ビタミン|vitamin|ネキシウム|nexium|セルシン|レンドルミン|マイスリー|デパス|ハルシオン|サイレース|ユーロジン|ワイパックス|ソラナックス|コンスタン|リーゼ/i;

const HAS_DOSE = /(\d+(?:\.\d+)?)\s*(mg|μg|ug|µg|g|IU|単位|錠)/i;

function norm(s: string): string {
  return String(s || "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDrug(m: MedicationItem): boolean {
  const name = norm(m.name);
  const usage = norm(m.usage);
  if (!name) return false;
  if (NON_DRUG_NAME.test(name)) return false;
  if (KNOWN_DRUG.test(name) || KNOWN_DRUG.test(m.id)) return true;
  if (HAS_DOSE.test(name) || HAS_DOSE.test(usage) || hasMicroDose(name) || hasMicroDose(usage))
    return true;
  if (/錠|OD|カプセル|散|液|軟膏|クリーム/i.test(name)) return true;
  // English fixture names (Amlodipine etc.) without JP form
  if (/^[A-Za-z][A-Za-z0-9 +/\-]{1,40}$/.test(name)) return true;
  return false;
}

function doseMg(text: string): number | null {
  const m = norm(text).match(/(\d+(?:\.\d+)?)\s*mg/i);
  return m ? Number(m[1]) : null;
}

function hasMicroDose(text: string): boolean {
  return /(\d+(?:\.\d+)?)\s*(μg|ug|µg)/i.test(norm(text));
}

/** Correct common OCR confusions and fill NSAID deprescribe defaults. */
function correctAndEnrich(m: MedicationItem): MedicationItem {
  let name = norm(m.name);
  let usage = norm(m.usage);
  const blob = `${name} ${usage}`;
  const mg = doseMg(blob);

  // ロラゼパム + 60mg → ロキソプロフェン (benzo 60mg almost never)
  if (/ロラゼパム|lorazepam/i.test(name) && mg !== null && mg >= 30) {
    name = "ロキソプロフェン錠60mg";
    usage = usage.includes("60") ? usage : "60mg";
  }

  // Explicit loxoprofen variants
  if (/ロキソプロフェン|loxoprofen/i.test(name)) {
    if (!/60/.test(name) && (mg === 60 || /60/.test(usage))) {
      name = name.includes("錠") ? name : "ロキソプロフェン錠60mg";
    }
    return {
      ...m,
      id: m.id?.startsWith("loxo") ? m.id : "loxoprofen",
      name,
      usage: usage || "60mg",
      recommendation: "stop",
      psychDependency: "NONE",
      annualCost: m.annualCost && m.annualCost > 0 ? m.annualCost : 15600,
      riskWeight: m.riskWeight && m.riskWeight > 0 ? m.riskWeight : 2,
      dosesPerDay: m.dosesPerDay && m.dosesPerDay > 0 ? m.dosesPerDay : 3,
      active: true,
      stepDown: m.stepDown ?? [],
    };
  }

  // Defaults for incomplete OCR rows
  return {
    ...m,
    name,
    usage: usage || m.usage,
    recommendation: m.recommendation || "continue",
    annualCost: m.annualCost && m.annualCost > 0 ? m.annualCost : 12000,
    riskWeight: m.riskWeight && m.riskWeight > 0 ? m.riskWeight : 1,
    dosesPerDay: m.dosesPerDay && m.dosesPerDay > 0 ? m.dosesPerDay : 1,
    active: m.active !== false,
    psychDependency: m.psychDependency || "NONE",
    stepDown: m.stepDown ?? [],
  };
}

/**
 * Deterministic post-OCR sanitize: drop facility lines, fix NSAID/benzo
 * confusions, keep English fixture names.
 */
export function sanitizeOcrMeds(meds: MedicationItem[]): MedicationItem[] {
  const out: MedicationItem[] = [];
  const seen = new Set<string>();
  for (const raw of meds) {
    if (!looksLikeDrug(raw)) continue;
    const m = correctAndEnrich(raw);
    const key = `${norm(m.name).toLowerCase()}|${norm(m.usage).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
