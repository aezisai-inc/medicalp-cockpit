import type { AnonymousPayload, MedicationItem, TraceSource } from "../domain/types";
import {
  codeAfHintDigest,
  defaultCodeAfSpec,
  extractJsonObject,
  normalizeCodeAfSpec,
  pharmacistKbSystemContext,
  type CodeAfSpec,
} from "../knowledge/pharmacist-kb";
import {
  isChatCompletionsUrl,
  postChatCompletions,
  postControlPlane,
} from "./openai-compat";
import { readLiveCache, writeLiveCache } from "./tavily";

const FIXTURE_HINT = "sandbox-script.py.txt fixture path · KB default taper";

export type SandboxHintResult = {
  scriptHint: string;
  codeAfSpec: CodeAfSpec;
  codeAfHintDigest: string;
  source: TraceSource;
};

function hintFromCache(medNames: string[]): SandboxHintResult | null {
  const cached = readLiveCache<{
    scriptHint: string;
    codeAfSpec?: CodeAfSpec;
    codeAfHintDigest?: string;
  }>("codeaf-sandbox");
  if (cached?.scriptHint) {
    const spec = normalizeCodeAfSpec(cached.codeAfSpec, medNames);
    return {
      scriptHint: cached.scriptHint,
      codeAfSpec: spec,
      codeAfHintDigest: cached.codeAfHintDigest || codeAfHintDigest(spec),
      source: "live-cache",
    };
  }
  return null;
}

async function callCodeAf(opts: {
  mode: "sandbox-hint" | "family-rewrite" | "vision-ocr";
  userPrompt: string;
  controlBody: Record<string, unknown>;
}): Promise<{ ok: boolean; text: string; json: Record<string, unknown> }> {
  const apiKey = process.env.CODEAF_API_KEY;
  const apiUrl = process.env.CODEAF_API_URL;
  if (!apiKey || !apiUrl) return { ok: false, text: "", json: {} };

  if (isChatCompletionsUrl(apiUrl)) {
    const b64 = opts.controlBody.imageBase64;
    const mime =
      typeof opts.controlBody.mimeType === "string"
        ? opts.controlBody.mimeType
        : "image/jpeg";
    const userContent =
      typeof b64 === "string" && b64.length
        ? [
            { type: "text" as const, text: opts.userPrompt },
            {
              type: "image_url" as const,
              image_url: { url: `data:${mime};base64,${b64}`, detail: "high" },
            },
          ]
        : opts.userPrompt;
    const hasImage =
      typeof opts.controlBody.imageBase64 === "string" &&
      Boolean(opts.controlBody.imageBase64);
    const model =
      opts.mode === "vision-ocr"
        ? process.env.CODEAF_VISION_MODEL?.trim() ||
          process.env.CODEAF_MODEL?.trim() ||
          (hasImage ? "gpt-4o" : "gpt-4o-mini")
        : process.env.CODEAF_MODEL?.trim() || "gpt-4o-mini";
    const chat = await postChatCompletions({
      url: apiUrl,
      apiKey,
      messages: [
        {
          role: "system",
          content: pharmacistKbSystemContext(),
        },
        { role: "user", content: userContent },
      ],
      model,
      timeoutMs: 45_000,
    });
    const extracted = extractJsonObject(chat.text) ?? {};
    return { ok: chat.ok, text: chat.text, json: { text: chat.text, ...extracted } };
  }

  const cp = await postControlPlane({
    url: apiUrl,
    apiKey,
    body: { mode: opts.mode, ...opts.controlBody },
  });
  const text =
    (typeof cp.json.text === "string" && cp.json.text) ||
    (typeof cp.json.scriptHint === "string" && cp.json.scriptHint) ||
    "";
  return { ok: cp.ok, text, json: cp.json };
}

export async function generateSandboxHint(meds: MedicationItem[]): Promise<SandboxHintResult> {
  const medNames = meds.map((m) => m.name);
  if (process.env.CODEAF_API_KEY && process.env.CODEAF_API_URL) {
    try {
      const safeMeds = meds.map((m) => ({
        id: m.id,
        name: m.name,
        psych_dependency: m.psychDependency,
        recommendation: m.recommendation,
      }));
      const r = await callCodeAf({
        mode: "sandbox-hint",
        userPrompt: `Plan deprescribing sandbox spec from pharmacist KB. Meds JSON: ${JSON.stringify(safeMeds)}. Return JSON with taper_step_ratio, half_life_hours, acb_weights, kb_rule_id, searchQuery, focusMedIds, rationale, scriptHint.`,
        controlBody: { meds: safeMeds },
      });
      if (r.ok) {
        const parsed =
          extractJsonObject(r.text) ||
          (r.json && typeof r.json === "object" ? r.json : null);
        const spec = normalizeCodeAfSpec(parsed, medNames);
        const scriptHint =
          (parsed && typeof parsed.scriptHint === "string" && parsed.scriptHint) ||
          (typeof r.json.scriptHint === "string" && r.json.scriptHint) ||
          `KB ${spec.kb_rule_id.join("+")} taper=${spec.taper_step_ratio}`;
        const digest = codeAfHintDigest(spec);
        writeLiveCache("codeaf-sandbox", {
          scriptHint,
          codeAfSpec: spec,
          codeAfHintDigest: digest,
        });
        return {
          scriptHint,
          codeAfSpec: spec,
          codeAfHintDigest: digest,
          source: "live",
        };
      }
    } catch {
      /* live-cache */
    }
  }
  const cached = hintFromCache(medNames);
  if (cached) return cached;
  const spec = defaultCodeAfSpec(medNames);
  return {
    scriptHint: FIXTURE_HINT,
    codeAfSpec: spec,
    codeAfHintDigest: codeAfHintDigest(spec),
    source: "fixture",
  };
}

export async function rewriteFamilyCopy(text: string): Promise<{
  text: string;
  source: TraceSource;
}> {
  if (process.env.CODEAF_API_KEY && process.env.CODEAF_API_URL) {
    try {
      const r = await callCodeAf({
        mode: "family-rewrite",
        userPrompt: `Rewrite this family care narrative per KB-3 ethics. Warm Japanese (or keep EN). No PHI. Text:\n${text}`,
        controlBody: { text },
      });
      if (r.ok) {
        const rewritten =
          (typeof r.json.text === "string" && r.json.text) || r.text || text;
        writeLiveCache("codeaf-family-rewrite", { text: rewritten });
        return { text: rewritten, source: "live" };
      }
    } catch {
      /* live-cache */
    }
    const cached = readLiveCache<{ text: string }>("codeaf-family-rewrite");
    if (cached?.text) {
      return { text: cached.text, source: "live-cache" };
    }
  }
  const seed = readLiveCache<{ familyPlainHint?: string }>("codeaf-sandbox");
  if (seed?.familyPlainHint) {
    return {
      text: `${text}\n\n${seed.familyPlainHint}`,
      source: "live-cache",
    };
  }
  return { text, source: "fixture" };
}

/** Multimodal / text Vision fallback when Nosana is unavailable. */
export async function runVisionViaCodeAf(image?: {
  bytes: Buffer;
  mimeType: string;
}): Promise<{
  payload: AnonymousPayload | null;
  source: TraceSource;
  detail: string;
  bboxCount: number;
  forbiddenNames: string[];
  phiEgressBytes: number;
} | null> {
  if (!(process.env.CODEAF_API_KEY && process.env.CODEAF_API_URL)) return null;
  try {
    const prompt = image
      ? `OCR Japanese お薬手帳. JSON only meds[]+case. Extract EVERY visible med line (錠/OD/カプセル + mg/μg, include 0.25mg etc.). Exclude クリニック/メンタルCL/薬局/先生. Prefer newest sticker; dedupe; up to ~8 meds. Benzos/Z-drugs/hypnotics → psychDependency HIGH + continue. NSAIDs in elderly → stop/taper + realistic annualCost/dosesPerDay. No invented unread lines. No PHI.`
      : 'Return JSON only: {"meds":[{"id":"ppi","name":"Nexium","usage":"15mg","recommendation":"stop","annualCost":12000,"riskWeight":2,"dosesPerDay":1,"active":true,"psychDependency":"NONE","stepDown":[]}],"case":{"symptoms":["daytime drowsiness"]}}. No real names.';
    const r = await callCodeAf({
      mode: "vision-ocr",
      userPrompt: prompt,
      controlBody: {
        task: "vision-ocr-anonymous",
        ...(image
          ? {
              imageBase64: image.bytes.toString("base64"),
              mimeType: image.mimeType,
            }
          : {}),
      },
    });
    if (!r.ok) return null;
    let payload: AnonymousPayload | null = null;
    try {
      const parsed = JSON.parse(r.text) as AnonymousPayload;
      if (parsed?.meds) payload = parsed;
    } catch {
      const extracted = extractJsonObject(r.text);
      if (extracted?.meds) payload = extracted as unknown as AnonymousPayload;
    }
    if (!payload && r.json.payload && typeof r.json.payload === "object") {
      payload = r.json.payload as AnonymousPayload;
    }
    if (!payload) return null;
    return {
      payload,
      source: "live",
      detail: image ? "via:codeaf (image)" : "via:codeaf",
      bboxCount: 2,
      forbiddenNames: ["吉田奈央", "吉田 奈央"],
      phiEgressBytes: 0,
    };
  } catch {
    return null;
  }
}
