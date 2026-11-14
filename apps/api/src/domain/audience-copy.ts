import type { AudienceMode, FamilyViewModel, Locale, MedicationItem } from "./types";

export const FAMILY_FORBIDDEN = ["ぶった斬り", "老健利益", "100床", "C.difficile", "ROI"] as const;

export function assertFamilyLexiconClean(text: string): void {
  for (const w of FAMILY_FORBIDDEN) {
    if (text.includes(w)) throw new Error(`family lexicon violation: ${w}`);
  }
}

export function projectAudienceCopy(
  mode: AudienceMode,
  meds: MedicationItem[],
  clinicianBlob: string,
  locale: Locale = "ja",
): { mode: AudienceMode; displayText: string; family?: FamilyViewModel } {
  if (mode === "clinician") {
    return { mode, displayText: clinicianBlob };
  }
  const locked = meds.filter((m) => m.psychDependency === "HIGH");
  const family: FamilyViewModel =
    locale === "en"
      ? {
          patientBenefitHeadline:
            "Gently tidy medicines so daytime feels clearer and safer",
          monthlyOutOfPocketCopy: "Out-of-pocket depends on which medicines remain",
          alertnessCopy: "Less daytime sleepiness — easier conversations",
          swallowEaseCopy: "Fewer doses means less daily burden",
          gentleGraduationTitle: "Gentle medicine graduation calendar",
          plainEvidence: [{ title: "Guideline-aligned plan (plain summary)" }],
        }
      : {
          patientBenefitHeadline: "お薬をゆっくり整理して、日中すっきり過ごせるように",
          monthlyOutOfPocketCopy: "自己負担の目安はお薬の種類に応じて変わります",
          alertnessCopy: "傾眠が減り、会話しやすくなることがあります",
          swallowEaseCopy: "飲む回数を減らして負担を軽くします",
          gentleGraduationTitle: "ゆっくりお薬卒業カレンダー",
          plainEvidence: [{ title: "ガイドラインに沿った整理（要約）" }],
        };
  const promise =
    locale === "en"
      ? locked.length > 0
        ? "We will not stop dependency-prone meds abruptly. We taper with the doctor."
        : "Keep needed meds; review the highest-burden ones first."
      : locked.length > 0
        ? "依存しやすいお薬は急に止めません。医師と相談しながらゆっくり進めます。"
        : "必要な薬は残し、負担の大きいものから順に見直します。";
  const displayText = [
    family.patientBenefitHeadline,
    family.gentleGraduationTitle,
    promise,
    family.monthlyOutOfPocketCopy,
  ].join("\n");
  assertFamilyLexiconClean(displayText);
  return { mode, displayText, family };
}
