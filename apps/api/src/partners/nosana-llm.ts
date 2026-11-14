import type { MedicationItem, TraceSource } from "../domain/types";
import { isChatCompletionsUrl, postChatCompletions } from "./openai-compat";

export type ImprovementItem = { title: string; detail: string; url?: string };

export type NarrativePack = {
  meds: MedicationItem[];
  form2SummaryDraft: string;
  improvementForecast: ImprovementItem[];
  source: TraceSource;
  fallbackReason?: string;
};

function partnerTimeoutMs(fallback = 10_000): number {
  const raw = process.env.NOSANA_TIMEOUT_MS || process.env.PARTNER_MS;
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type EvidenceHit = { title: string; url?: string; snippet?: string };

/** Per-drug clinical risk phrases so SEED/template rows are not identical copy-paste. */
const DRUG_RISK_JA: { keys: string[]; stop: string; taper: string }[] = [
  {
    keys: ["ミオナール", "エペリゾン", "eperisone", "myonal"],
    stop: "中枢性筋弛緩薬の傾眠・ふらつき・転倒リスクが高く中止を提案します",
    taper: "中枢性筋弛緩薬のため段階的減量し転倒・傾眠を観察します",
  },
  {
    keys: ["ネキシウム", "オメプラ", "ランソプラ", "エソメプラ", "PPI", "nexium", "omeprazole", "esomeprazole"],
    stop: "長期PPI漫然投与による骨折・腎機能低下リスクが高く中止を提案します",
    taper: "長期PPIのためリバウンドに留意して漸減を提案します",
  },
  {
    keys: ["フロセミド", "ラシックス", "furosemide", "lasix"],
    stop: "ループ利尿薬の脱水・起立性低血圧リスクを踏まえ中止を提案します",
    taper: "ループ利尿薬のためeGFRを踏まえ脱水・起立性低血圧に留意して漸減します",
  },
  {
    keys: ["ガスモチン", "モサプリド", "gasmotin", "mosapride"],
    stop: "対症療法の漫然継続を見直し服薬負担軽減のため中止を提案します",
    taper: "消化管運動薬の対症漫然を見直し漸減を提案します",
  },
  {
    keys: ["メチコバール", "ビタミンB12", "mecobalamin", "methycobal", "vitamin b12"],
    stop: "漫然対症投与の見直しと服薬負担軽減のため中止を提案します",
    taper: "ビタミンB12製剤の必要性を再評価し漸減を提案します",
  },
];

function drugRiskPhrase(name: string, rec: string, locale: "ja" | "en"): string {
  const lower = name.toLowerCase();
  const hit = DRUG_RISK_JA.find((row) =>
    row.keys.some((k) => name.includes(k) || lower.includes(k.toLowerCase())),
  );
  if (locale === "en") {
    if (hit) {
      return rec === "taper"
        ? `${name}: ${hit.taper}`
        : rec === "stop"
          ? `${name}: ${hit.stop}`
          : `${name}: continue with monitoring.`;
    }
    if (rec === "stop") return `Stop candidate: deprescribe ${name} after benefit-risk review in frail elderly.`;
    if (rec === "taper") return `Taper candidate: reduce ${name} stepwise per guideline.`;
    return `Continue ${name} for now.`;
  }
  if (hit) {
    return rec === "taper" ? `${name}は${hit.taper}` : rec === "stop" ? `${name}は${hit.stop}` : `${name}は当面継続とします。`;
  }
  if (rec === "stop") return `${name}は高齢者の医薬品適正使用の観点で中止を提案します`;
  if (rec === "taper") return `${name}は段階的減量（漸減）を提案します`;
  return `${name}は当面継続とします。`;
}

function pickEvidenceHit(
  name: string,
  evidence: EvidenceHit[],
  medIndex: number,
): EvidenceHit | undefined {
  if (!evidence.length) return undefined;
  const lower = name.toLowerCase();
  const named = evidence.find((e) => {
    const blob = `${e.title} ${e.snippet ?? ""}`.toLowerCase();
    return name.length >= 2 && (blob.includes(lower) || blob.includes(name));
  });
  if (named) return named;
  return evidence[medIndex % evidence.length];
}

function buildGroundedRationale(
  m: MedicationItem,
  evidence: EvidenceHit[],
  medIndex: number,
  locale: "ja" | "en",
): { rationale: string; guidelineRef: string } {
  const rec = m.recommendation;
  const risk =
    m.psychDependency === "HIGH" && rec !== "continue"
      ? locale === "en"
        ? `Continue / lock: abrupt stop of ${m.name} is unsafe.`
        : `${m.name}は依存ロック薬のため急な中止はせず継続保護します。`
      : drugRiskPhrase(m.name, rec, locale);
  const hit = pickEvidenceHit(m.name, evidence, medIndex);
  if (!hit) {
    const missing = locale === "en" ? " (evidence unavailable)" : "（エビデンス未取得）";
    return {
      rationale: m.rationale || `${risk}${missing}`,
      guidelineRef:
        m.guidelineRef ||
        (locale === "en" ? "MHLW appropriate use in older adults" : "厚労省 高齢者の医薬品適正使用"),
    };
  }
  const snip = (hit.snippet || "").replace(/\s+/g, " ").slice(0, 80);
  const cite =
    locale === "en"
      ? ` (evidence: ${hit.title}${snip ? ` — ${snip}` : ""})`
      : `（根拠: ${hit.title}${snip ? ` — ${snip}` : ""}）`;
  return {
    rationale: m.rationale || `${risk}${cite}`,
    guidelineRef: m.guidelineRef || hit.title,
  };
}

/** Dual Form2 draft lines must reuse the same grounded rationale as evaluationBullets. */
export function buildForm2SummaryDraft(
  meds: MedicationItem[],
  locale: "ja" | "en" = "ja",
): string {
  const lines = meds
    .filter((m) => m.recommendation === "stop" || m.recommendation === "taper")
    .map((m) =>
      locale === "en"
        ? `・${m.name}（${m.recommendation === "stop" ? "stop" : "taper"}）: ${m.rationale}`
        : `・${m.name}（${m.recommendation === "stop" ? "中止" : "漸減"}）: ${m.rationale}`,
    );
  const lockNames = meds
    .filter((m) => m.psychDependency === "HIGH")
    .map((m) => m.name)
    .slice(0, 2);
  return locale === "en"
    ? [
        "Deprescribing proposal (named agents):",
        ...lines,
        lockNames.length
          ? `Protected lock meds (no abrupt stop): ${lockNames.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "薬剤調整総合評価（様式2たたき台・実薬名）:",
        ...lines,
        lockNames.length
          ? `依存ロック保護（急な中止禁止）: ${lockNames.join("・")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
}

function looksGenericRationale(text: string | undefined): boolean {
  if (!text || !text.trim()) return true;
  const t = text.trim();
  if (t.length < 12) return true;
  return /治療計画を最適化|患者の全体的な健康状態|optimize the treatment plan|全体的な健康/i.test(t);
}

function rationalesAreUniform(meds: MedicationItem[]): boolean {
  const stopTaper = meds.filter(
    (m) => m.recommendation === "stop" || m.recommendation === "taper",
  );
  if (stopTaper.length < 2) return false;
  const set = new Set(stopTaper.map((m) => (m.rationale || "").trim()));
  return set.size === 1;
}

/** Sync deterministic narrative (timeout / no-key fallback). */
export function buildNarrativeFallback(
  meds: MedicationItem[],
  evidence: EvidenceHit[],
  locale: "ja" | "en" = "ja",
): NarrativePack {
  return templatePack(meds, evidence, locale);
}

function templatePack(
  meds: MedicationItem[],
  evidence: EvidenceHit[],
  locale: "ja" | "en",
): NarrativePack {
  const enriched = meds.map((m, medIndex) => {
    const rec = m.recommendation;
    const grounded = buildGroundedRationale(m, evidence, medIndex, locale);
    const rationale = grounded.rationale;
    const guidelineRef = grounded.guidelineRef;
    const expectedImprovement =
      m.expectedImprovement ||
      (rec === "continue"
        ? undefined
        : locale === "en"
          ? "Less daytime sedation / lower fall risk / organ protection"
          : "昼間の傾眠改善・ふらつき/転倒リスク低減・臓器保護");
    return { ...m, rationale, guidelineRef, expectedImprovement };
  });

  const form2SummaryDraft = buildForm2SummaryDraft(enriched, locale);

  const improvementForecast: ImprovementItem[] = enriched
    .filter((m) => m.recommendation === "stop" || m.recommendation === "taper")
    .map((m) => ({
      title: m.name,
      detail:
        m.expectedImprovement ||
        (locale === "en"
          ? `${m.name}: lower fall/sedation risk after ${m.recommendation}`
          : `${m.name}: ${m.recommendation === "stop" ? "中止" : "漸減"}によりふらつき・傾眠リスク低減が期待`),
      url: evidence.find((e) => e.url)?.url,
    }));

  if (!improvementForecast.length && evidence[0]) {
    improvementForecast.push({
      title: evidence[0].title,
      detail: evidence[0].snippet || "",
      url: evidence[0].url,
    });
  }

  return {
    meds: enriched,
    form2SummaryDraft,
    improvementForecast,
    source: "fixture",
    fallbackReason: "fixture_mode",
  };
}

function parseNarrative(text: string): Partial<NarrativePack> | null {
  try {
    const j = JSON.parse(text) as Partial<NarrativePack> & {
      medRationales?: Record<string, { rationale?: string; guidelineRef?: string; expectedImprovement?: string }>;
    };
    return j;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Partial<NarrativePack>;
    } catch {
      return null;
    }
  }
}

/** Nosana/OpenAI-compat narrative pack for form2 + accordion rationales. */
export async function generateAuditNarrative(opts: {
  meds: MedicationItem[];
  evidence: { title: string; url?: string; snippet?: string }[];
  locale?: "ja" | "en";
}): Promise<NarrativePack> {
  const locale = opts.locale ?? "ja";
  const timeoutMs = partnerTimeoutMs(10_000);
  const fallbackBase = templatePack(opts.meds, opts.evidence, locale);
  const url = process.env.NOSANA_VISION_URL || process.env.CODEAF_API_URL;
  const apiKey = process.env.NOSANA_API_KEY || process.env.CODEAF_API_KEY;
  if (!url || !apiKey || !isChatCompletionsUrl(url)) {
    return {
      ...fallbackBase,
      fallbackReason: "endpoint_unconfigured",
    };
  }

  // Text narrative: prefer fast text model (not vision gpt-4o) to avoid audit/run 504.
  const model =
    process.env.NOSANA_TEXT_MODEL?.trim() ||
    process.env.CODEAF_MODEL?.trim() ||
    "gpt-4o-mini";

  const prompt = `You are Care-Audit clinical writer. Return JSON ONLY:
{"meds":[{"id":"...","rationale":"...","guidelineRef":"...","expectedImprovement":"..."}],"form2SummaryDraft":"...","improvementForecast":[{"title":"...","detail":"...","url":"..."}]}
Locale=${locale}. Meds=${JSON.stringify(opts.meds.map((m) => ({ id: m.id, name: m.name, recommendation: m.recommendation, psychDependency: m.psychDependency })))}
Evidence=${JSON.stringify(opts.evidence.slice(0, 8))}
Rules:
- HIGH psychDependency must not recommend abrupt stop. Keep ids stable.
- MUST name concrete medication names from input (e.g. オメプラゾール / フロセミド / ロラゼパム / レンドルミン) and clinical risks (fall, sedation, chronic PPI, dehydration/electrolytes, psych-lock protection).
- Each stop/taper rationale MUST cite a DIFFERENT Evidence title when multiple hits exist (rotate hits; do NOT paste the same hit for every drug). Format JA: "（根拠: <title> — <snippet≤80>）" / EN: " (evidence: <title> — <snippet>)".
- form2SummaryDraft MUST list each stop/taper drug with the SAME grounded rationale text used in meds[].rationale (二重帳票同期).
- FORBIDDEN abstract boilerplate such as "治療計画を最適化します" / "患者の全体的な健康状態が向上" / "optimize the treatment plan" / identical "漫然投与" lines for every drug without per-drug risk + evidence cite.`;

  const timeoutFallback: NarrativePack = {
    ...fallbackBase,
    fallbackReason: `timeout_${timeoutMs}ms`,
  };

  try {
    const chat = await postChatCompletions({
      url,
      apiKey,
      model,
      timeoutMs,
      maxTokens: 600,
      messages: [
        { role: "system", content: "Return JSON only. No PHI." },
        { role: "user", content: prompt },
      ],
    });
    if (!chat.ok) {
      return {
        ...fallbackBase,
        fallbackReason: "http_error",
      };
    }
    const parsed = parseNarrative(chat.text);
    if (!parsed) return timeoutFallback;

    const byId = new Map(
      (Array.isArray(parsed.meds) ? parsed.meds : []).map((m) => [m.id, m]),
    );
    let meds = opts.meds.map((m) => {
      const extra = byId.get(m.id) as Partial<MedicationItem> | undefined;
      const fb = fallbackBase.meds.find((x) => x.id === m.id);
      const liveRationale = extra?.rationale || m.rationale;
      return {
        ...m,
        rationale: looksGenericRationale(liveRationale)
          ? fb?.rationale || liveRationale
          : liveRationale,
        guidelineRef:
          extra?.guidelineRef ||
          m.guidelineRef ||
          fb?.guidelineRef,
        expectedImprovement:
          extra?.expectedImprovement ||
          m.expectedImprovement ||
          fb?.expectedImprovement,
      };
    });
    // Copy-paste uniform trap: if every stop/taper rationale is identical, force template grounding.
    if (rationalesAreUniform(meds)) {
      meds = meds.map((m) => {
        const fb = fallbackBase.meds.find((x) => x.id === m.id);
        return fb
          ? {
              ...m,
              rationale: fb.rationale,
              guidelineRef: fb.guidelineRef || m.guidelineRef,
            }
          : m;
      });
    }
    // 二重帳票: form2SummaryDraft は meds[].rationale と同一根拠を必ず共有
    const form2SummaryDraft = buildForm2SummaryDraft(meds, locale);

    return {
      meds,
      form2SummaryDraft,
      improvementForecast:
        Array.isArray(parsed.improvementForecast) && parsed.improvementForecast.length
          ? parsed.improvementForecast
          : fallbackBase.improvementForecast,
      source: "live",
    };
  } catch {
    return timeoutFallback;
  }
}
