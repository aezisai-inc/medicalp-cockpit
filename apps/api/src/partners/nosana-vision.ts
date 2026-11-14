import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixturesRoot } from "../domain/paths";
import { sanitizeOcrMeds } from "../domain/med-ocr-sanitize";
import { enrichPsychLocks } from "../domain/psych-lock";
import type {
  AnonymousPayload,
  ImageNatural,
  PhiBox,
  TraceSource,
} from "../domain/types";
import { runVisionViaCodeAf } from "./codeaf";
import {
  isChatCompletionsUrl,
  postChatCompletions,
  postControlPlane,
} from "./openai-compat";
import { readLiveCache, writeLiveCache } from "./tavily";

const FIXTURES = fixturesRoot();

export type VisionImageInput = {
  bytes: Buffer;
  mimeType: string;
};

export type VisionScanResult = {
  payload: AnonymousPayload;
  source: TraceSource;
  detail: string;
  bboxCount: number;
  boxes: PhiBox[];
  imageNatural: ImageNatural;
  forbiddenNames: string[];
  phiEgressBytes: number;
  fallbackReason?: string;
};

type BboxFile = {
  natural?: ImageNatural;
  boxes: PhiBox[];
};

function loadBboxFile(): BboxFile {
  const bboxPath = join(FIXTURES, "paper-scan/souvenir-notebook-v1.bbox.json");
  if (!existsSync(bboxPath)) {
    return {
      natural: { width: 1240, height: 1754 },
      boxes: [
        { label: "patientName", x: 12, y: 20, w: 120, h: 24 },
        { label: "hospitalName", x: 200, y: 18, w: 140, h: 22 },
      ],
    };
  }
  const raw = JSON.parse(readFileSync(bboxPath, "utf8")) as BboxFile & {
    boxes?: PhiBox[];
  };
  const boxes = Array.isArray(raw.boxes) ? raw.boxes : [];
  return {
    natural: raw.natural ?? { width: 1240, height: 1754 },
    boxes,
  };
}

function partnerTimeoutMs(fallback = 5_000): number {
  const raw = process.env.NOSANA_TIMEOUT_MS || process.env.PARTNER_MS;
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const OCR_PROMPT = `You OCR a Japanese お薬手帳 photo. Return JSON ONLY:
{"meds":[{"id":"slug","name":"一般名+規格","usage":"strength","recommendation":"continue|taper|stop","annualCost":12000,"riskWeight":1,"dosesPerDay":1,"active":true,"psychDependency":"NONE|HIGH","stepDown":[]}],"case":{"ageGroup":"elderly","egfr":40,"symptoms":[],"careLevel":"unknown"}}

Rules:
1) Extract EVERY visible medication line (…錠/OD/カプセル/散/液 + mg or μg). Prefer the newest dispensing sticker (e.g. 令和). Deduplicate same ingredient+strength. Typical notebook pages have up to ~8 distinct meds — include all you can read.
2) NEVER put clinic/pharmacy/doctor/patient into meds (クリニック, メンタルCL, 薬局, 先生, 様, TEL, 住所).
3) name = ingredient + form + strength (keep OD/カプセル and decimal strengths such as 0.25mg). Put the same strength in usage.
4) Benzodiazepines / Z-drugs / related hypnotics → psychDependency HIGH, recommendation continue (no abrupt stop in output).
5) NSAIDs / PPIs / diuretics in elderly polypharmacy: set recommendation stop or taper when label implies chronic symptomatic use; estimate annualCost from typical JP dispensing (e.g. 3x/day NSAID ≈ 15000–18000 JPY/year). Do not mis-label NSAIDs as benzodiazepines.
6) id = ascii slug from ingredient. Do not invent unread lines. No PHI names.`;

function loadResident(): AnonymousPayload {
  const path = join(FIXTURES, "resident-souvenir-v1.json");
  return JSON.parse(readFileSync(path, "utf8")) as AnonymousPayload;
}

function bboxCount(): number {
  return loadBboxFile().boxes.length || 2;
}

function fixtureVision(): VisionScanResult {
  const resident = loadResident();
  const bbox = loadBboxFile();
  const reason =
    process.env.NOSANA_VISION_URL || process.env.CODEAF_API_URL
      ? "fixture_mode"
      : "endpoint_unconfigured";
  return {
    payload: { ...resident, meds: enrichPsychLocks(resident.meds) },
    source: "fixture",
    detail: `fixture OCR (${reason})`,
    bboxCount: bbox.boxes.length || 2,
    boxes: bbox.boxes,
    imageNatural: bbox.natural ?? { width: 1240, height: 1754 },
    forbiddenNames: ["山田花子", "〇〇総合病院", "吉田奈央", "吉田 奈央"],
    phiEgressBytes: 0,
    fallbackReason: reason,
  };
}

function fromPlanBCache(): VisionScanResult | null {
  const meta = readLiveCache<{
    bboxCount?: number;
    boxes?: PhiBox[];
    imageNatural?: ImageNatural;
    forbiddenNames?: string[];
    detail?: string;
    payload?: AnonymousPayload;
  }>("nosana-vision");
  if (!meta) return null;
  const bbox = loadBboxFile();
  const payload = meta.payload ?? loadResident();
  return {
    payload: { ...payload, meds: enrichPsychLocks(payload.meds) },
    source: "live-cache",
    detail:
      meta.detail ??
      "Plan B closed-model OCR replay (seed). PHI stripped before partner egress.",
    bboxCount: meta.bboxCount ?? (bbox.boxes.length || bboxCount()),
    boxes: meta.boxes?.length ? meta.boxes : bbox.boxes,
    imageNatural: meta.imageNatural ?? bbox.natural ?? { width: 1240, height: 1754 },
    forbiddenNames: meta.forbiddenNames ?? [
      "山田花子",
      "〇〇総合病院",
      "吉田奈央",
      "吉田 奈央",
    ],
    phiEgressBytes: 0,
    fallbackReason: "fixture_mode",
  };
}

function dataUrl(image: VisionImageInput): string {
  const mime = image.mimeType || "image/jpeg";
  return `data:${mime};base64,${image.bytes.toString("base64")}`;
}

function parsePayload(text: string): AnonymousPayload | null {
  const finish = (payload: AnonymousPayload | null) => {
    if (!payload?.meds?.length) return null;
    return {
      ...payload,
      meds: enrichPsychLocks(sanitizeOcrMeds(payload.meds)),
    };
  };
  try {
    return finish(JSON.parse(text) as AnonymousPayload);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return finish(JSON.parse(m[0]) as AnonymousPayload);
    } catch {
      return null;
    }
  }
}

async function tryNosanaLive(
  image?: VisionImageInput,
): Promise<Omit<VisionScanResult, "source"> | null> {
  const url = process.env.NOSANA_VISION_URL;
  if (!url) return null;
  const apiKey = process.env.NOSANA_API_KEY || "nosana-live";
  const bbox = loadBboxFile();
  const timeoutMs = Math.max(partnerTimeoutMs(5_000), 15_000);

  if (isChatCompletionsUrl(url)) {
    const userContent = image
      ? [
          { type: "text" as const, text: OCR_PROMPT },
          {
            type: "image_url" as const,
            image_url: { url: dataUrl(image), detail: "high" },
          },
        ]
      : OCR_PROMPT;
    const chat = await postChatCompletions({
      url,
      apiKey,
      messages: [
        {
          role: "system",
          content: "Vision OCR for Care-Audit. JSON only. No PHI.",
        },
        { role: "user", content: userContent },
      ],
      model:
        process.env.NOSANA_VISION_MODEL?.trim() ||
        process.env.CODEAF_VISION_MODEL?.trim() ||
        (image ? "gpt-4o" : "gpt-4o-mini"),
      timeoutMs,
    });
    if (!chat.ok) return null;
    const payload = parsePayload(chat.text);
    if (!payload) return null;
    return {
      payload: {
        ...payload,
        meds: enrichPsychLocks(sanitizeOcrMeds(payload.meds)),
      },
      detail: image ? "Nosana vision live (image)" : "Nosana vision live",
      bboxCount: bbox.boxes.length || 2,
      boxes: bbox.boxes,
      imageNatural: bbox.natural ?? { width: 1240, height: 1754 },
      forbiddenNames: ["吉田奈央", "吉田 奈央"],
      phiEgressBytes: 0,
    };
  }

  const cp = await postControlPlane({
    url,
    apiKey,
    body: {
      mode: "ocr-anonymized",
      egress: "drug-names-only",
      ...(image
        ? {
            imageBase64: image.bytes.toString("base64"),
            mimeType: image.mimeType,
          }
        : {}),
    },
    timeoutMs,
  });
  if (!cp.ok) return null;
  const raw = (cp.json.payload ?? cp.json) as AnonymousPayload;
  if (!raw?.meds?.length) return null;
  return {
    payload: { ...raw, meds: enrichPsychLocks(sanitizeOcrMeds(raw.meds)) },
    detail: image ? "Nosana vision live (image)" : "Nosana vision live",
    bboxCount: bbox.boxes.length || 2,
    boxes: bbox.boxes,
    imageNatural: bbox.natural ?? { width: 1240, height: 1754 },
    forbiddenNames: ["吉田奈央", "吉田 奈央"],
    phiEgressBytes: 0,
  };
}

export class VisionOcrRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionOcrRequiredError";
  }
}

/** Nosana Plan A live GPU OCR → CodeAF multimodal → (no-image only) live-cache → fixture. */
export async function runVisionScan(
  image?: VisionImageInput,
): Promise<VisionScanResult> {
  const hasImage = Boolean(image?.bytes?.length);
  const bbox = loadBboxFile();

  if (process.env.NOSANA_VISION_URL) {
    try {
      const live = await tryNosanaLive(image);
      if (live) {
        writeLiveCache("nosana-vision", live);
        return { ...live, source: "live" };
      }
    } catch {
      /* fallback */
    }
  }

  const viaCodeAf = await runVisionViaCodeAf(image);
  if (viaCodeAf?.payload) {
    const record: VisionScanResult = {
      payload: {
        ...viaCodeAf.payload,
        meds: enrichPsychLocks(sanitizeOcrMeds(viaCodeAf.payload.meds)),
      },
      source: viaCodeAf.source,
      detail: viaCodeAf.detail,
      bboxCount: viaCodeAf.bboxCount,
      boxes: bbox.boxes,
      imageNatural: bbox.natural ?? { width: 1240, height: 1754 },
      forbiddenNames: viaCodeAf.forbiddenNames,
      phiEgressBytes: viaCodeAf.phiEgressBytes,
    };
    writeLiveCache("nosana-vision", {
      payload: record.payload,
      detail: record.detail,
      bboxCount: record.bboxCount,
      boxes: record.boxes,
      imageNatural: record.imageNatural,
      forbiddenNames: record.forbiddenNames,
    });
    return record;
  }

  if (hasImage) {
    throw new VisionOcrRequiredError(
      "Vision OCR failed for uploaded image (Nosana/CodeAF unavailable). Silent fixture fallback is forbidden.",
    );
  }

  return fromPlanBCache() ?? fixtureVision();
}

export { loadBboxFile, partnerTimeoutMs };
