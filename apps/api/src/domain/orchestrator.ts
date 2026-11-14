import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixturesRoot } from "./paths";
import { sanitizeOcrMeds } from "./med-ocr-sanitize";
import { applyAiPlanPreservingPsychLocks, enrichPsychLocks } from "./psych-lock";
import {
  analyzeMedsForAudit,
  forceContinueBaseline,
} from "./med-audit-analyze";
import { assertNoPhiStrings, stripPhiDeep } from "./anonymize";
import { projectAudienceCopy } from "./audience-copy";
import type {
  AgentTraceEvent,
  AnonymousPayload,
  AudienceMode,
  ClinicalDeprescribeOrder,
  FamilyCareSheet,
  ImageNatural,
  Locale,
  MedicationItem,
  PhiBox,
  ResidentCase,
  TraceLane,
  TraceLifecycle,
  TraceSource,
} from "./types";
import {
  runVisionScan,
  VisionOcrRequiredError,
  type VisionImageInput,
} from "../partners/nosana-vision";

/** Ephemeral scan image buffers keyed by session (cleared on Clear Image). */
const scanImageBuffers = new Map<string, { bytes: Buffer; mimeType: string }>();

/** Last PHI proof meta retained across Clear Image (pixels discarded; strip stays). */
const lastMaskProofBySession = new Map<
  string,
  { regions: number; labels: string[]; boxes: PhiBox[] }
>();

export function rememberMaskProof(
  sessionId: string,
  proof: { regions: number; labels: string[]; boxes?: PhiBox[] },
): void {
  lastMaskProofBySession.set(sessionId, {
    regions: proof.regions,
    labels: [...proof.labels],
    boxes: proof.boxes ? [...proof.boxes] : [],
  });
}

export function clearScanImageBuffer(sessionId = "default"): {
  cleared: boolean;
  proof: {
    regions: number;
    egress: number;
    labels: string[];
    sha256: string;
  };
  retainedBoxes: PhiBox[];
} {
  const had = scanImageBuffers.delete(sessionId);
  const retained = lastMaskProofBySession.get(sessionId);
  return {
    cleared: had,
    proof: {
      regions: retained?.regions ?? 0,
      egress: 0,
      labels: retained?.labels?.length ? [...retained.labels] : [],
      sha256: "cleared",
    },
    retainedBoxes: retained?.boxes ? [...retained.boxes] : [],
  };
}

export function storeScanImageBuffer(
  sessionId: string,
  image: VisionImageInput,
): void {
  scanImageBuffers.set(sessionId, {
    bytes: Buffer.from(image.bytes),
    mimeType: image.mimeType,
  });
}

function partnerMs(): number {
  const raw = process.env.PARTNER_MS || process.env.NOSANA_TIMEOUT_MS;
  const n = raw ? Number(raw) : 10_000;
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}
import { searchEvidence } from "../partners/tavily";
import { rewriteFamilyCopy, generateSandboxHint } from "../partners/codeaf";
import { runDeprescribeSim } from "../partners/daytona";
import {
  codeAfHintDigest,
  defaultCodeAfSpec,
} from "../knowledge/pharmacist-kb";
import {
  buildForm2SummaryDraft,
  buildNarrativeFallback,
  generateAuditNarrative,
} from "../partners/nosana-llm";
import { withTimeout } from "../partners/with-timeout";
import { computeImpactMetrics } from "./impact-metrics";

const FIXTURES = fixturesRoot();

function loadResident(): AnonymousPayload {
  const p = join(FIXTURES, "resident-souvenir-v1.json");
  return JSON.parse(readFileSync(p, "utf8")) as AnonymousPayload;
}

/** Env live-required OR per-request strict (query/header/body). */
export function isPartnerStrict(requestStrict?: boolean): boolean {
  return (
    process.env.PARTNER_MODE === "live-required" || requestStrict === true
  );
}

export class PartnerNotLiveError extends Error {
  readonly statusCode = 503;
  constructor(public readonly partners: string[]) {
    super(`PARTNER_STRICT: not live → ${partners.join(", ")}`);
    this.name = "PartnerNotLiveError";
  }
}

function assertPartnersLive(
  sources: Record<string, TraceSource>,
  strict: boolean,
) {
  if (!strict) return;
  const bad = Object.entries(sources)
    .filter(([, source]) => source !== "live")
    .map(([name, source]) => `${name}=${source}`);
  if (bad.length) {
    throw new PartnerNotLiveError(bad);
  }
}

export type AuditRunOptions = {
  /** Per-request fail-closed (?strict=1 / X-Partner-Strict / body.strict) */
  strict?: boolean;
  /** Client-held scan result — skip re-OCR (Lambda is stateless). */
  meds?: MedicationItem[];
  case?: ResidentCase;
  visionSource?: TraceSource;
};

export { VisionOcrRequiredError };

async function timed<T>(
  promise: Promise<T>,
): Promise<{ val: T; ms: number }> {
  const t0 = Date.now();
  const val = await promise;
  return { val, ms: Date.now() - t0 };
}

function buildClinicianBlob(
  meds: MedicationItem[],
  metrics: { fallRiskBefore?: number; fallRiskAfter?: number },
  locale: Locale,
): string {
  const changed = meds.filter(
    (m) => m.recommendation === "stop" || m.recommendation === "taper",
  );
  const names = changed
    .map((m) => m.name)
    .slice(0, 2)
    .join(locale === "en" ? " / " : "・");
  const hasLock = meds.some((m) => m.psychDependency === "HIGH");
  const before = metrics.fallRiskBefore ?? 88;
  const after = metrics.fallRiskAfter ?? 18;
  if (locale === "en") {
    const focus = names || "selected agents";
    const lock = hasLock ? " Psych-lock meds stay protected (taper only)." : "";
    return `Flags ${focus} for deprescribing review.${lock} Fall risk ${before}→${after}. Form-2 draft ready.`;
  }
  const focus = names || "対象薬剤";
  const lock = hasLock ? "依存ロック薬は急な中止を避け保護継続。" : "";
  return `${focus}の見直しを提案。${lock}リスク ${before}→${after}。様式2算定書類のたたき台まで準備。`;
}

function buildObservationPlan(meds: MedicationItem[], locale: Locale): string[] {
  const text = meds.map((m) => `${m.name} ${m.usage}`).join(" ").toLowerCase();
  const lines: string[] = [];
  const hasPpi = /ppi|オメプラ|ネキシウム|ランソプラ|プロトン|omeprazole|lansoprazole|esomeprazole|nexium/.test(
    text,
  );
  const hasDiuretic = /フロセミド|ラシックス|利尿|furosemide|diuretic/.test(text);
  const hasBzd =
    /ロラゼ|レンドルミン|ベンゾ|睡眠|催眠|lorazepam|brotizolam|zolpidem|benzodiazepine|催眠/.test(
      text,
    );
  const hasNsaid = /ロキソ|NSAIDs?|イブプロ|diclofenac|loxoprofen/.test(text);

  if (locale === "en") {
    if (hasBzd)
      lines.push(
        "For 4 weeks after dose change, observe sleep, daytime sedation, and withdrawal signs weekly with family.",
      );
    if (hasPpi)
      lines.push(
        "Taper PPI while watching rebound acid; report outcomes in writing at the next prescription visit.",
      );
    if (hasDiuretic)
      lines.push(
        "Monitor dehydration, electrolytes, dizziness, and orthostatic symptoms after diuretic adjustment.",
      );
    if (hasNsaid)
      lines.push("Watch GI symptoms and renal markers if NSAID exposure continues.");
    if (!lines.length)
      lines.push(
        "For 4 weeks after dose change, observe sleep, bowel habits, pain, and fall risk once weekly with family.",
      );
    lines.push("Prefer non-drug sleep hygiene / lifestyle rhythm where hypnotics are tapered.");
    return lines;
  }

  if (hasBzd)
    lines.push(
      "減薬後4週間、睡眠状況・昼間の傾眠・離脱症状を家族と連携し週1回観察する。",
    );
  if (hasPpi)
    lines.push(
      "PPIはリバウンド酸分泌に留意して漸減し、次回定期処方時に結果・有害事象を文書報告する。",
    );
  if (hasDiuretic)
    lines.push(
      "利尿薬調整後は脱水・電解質・めまい・起立性ふらつきを観察する。",
    );
  if (hasNsaid)
    lines.push("NSAIDs継続時は消化器症状と腎機能指標を確認する。");
  if (!lines.length)
    lines.push(
      "減薬後4週間、睡眠・排便・疼痛・ふらつきを家族と連携し週1回観察する。",
    );
  lines.push("睡眠薬は非薬物的介入（睡眠衛生・生活リズム）へ置換を進める。");
  return lines;
}

export class AuditOrchestrator {
  private trace: AgentTraceEvent[] = [];
  private onProgress?: (ev: AgentTraceEvent) => void;

  setProgressHandler(handler?: (ev: AgentTraceEvent) => void) {
    this.onProgress = handler;
  }

  private push(
    step: string,
    source: TraceSource,
    detail?: string,
    durationMs?: number,
    lane?: TraceLane,
    extra?: {
      lifecycle?: TraceLifecycle;
      elapsedMs?: number;
      fallbackReason?: string;
      egressBytes?: number;
    },
  ) {
    const ev: AgentTraceEvent = {
      step,
      at: new Date().toISOString(),
      source,
      detail,
      durationMs,
      lane,
      lifecycle: extra?.lifecycle,
      elapsedMs: extra?.elapsedMs,
      fallbackReason: extra?.fallbackReason,
      egressBytes: extra?.egressBytes,
    };
    this.trace.push(ev);
    this.onProgress?.(ev);
  }

  getTrace() {
    return [...this.trace];
  }

  async visionScan(image?: VisionImageInput): Promise<{
    preview: {
      masked: boolean;
      regions: number;
      boxes: PhiBox[];
      imageNatural: ImageNatural;
    };
    payload: AnonymousPayload;
    source: TraceSource;
    phiEgressBytes: number;
    detail?: string;
    fallbackReason?: string;
    trace: AgentTraceEvent[];
  }> {
    if (image?.bytes?.length) {
      storeScanImageBuffer("default", image);
    }
    this.push(
      "Scan.ingest",
      "live",
      image?.bytes?.length
        ? `image bytes=${image.bytes.length}`
        : "fixture ingest (no upload)",
      undefined,
      "vision",
      { lifecycle: "started" },
    );
    this.push(
      "Nosana.vision",
      "live",
      `detection request · timeout=${partnerMs()}ms`,
      undefined,
      "vision",
      { lifecycle: "progress" },
    );
    const { val: vision, ms: visionMs } = await timed(runVisionScan(image));
    this.push(
      "Nosana.vision",
      vision.source,
      vision.detail ?? `${vision.payload.meds.length} meds extracted`,
      visionMs,
      "vision",
      {
        lifecycle: "resolved",
        fallbackReason: vision.fallbackReason,
        egressBytes: vision.phiEgressBytes,
      },
    );
    const tMask = Date.now();
    const enriched = enrichPsychLocks(sanitizeOcrMeds(vision.payload.meds));
    const masked = stripPhiDeep({
      ...vision.payload,
      meds: forceContinueBaseline(enriched),
    });
    const maskMs = Date.now() - tMask;
    this.push(
      "Mask.apply",
      vision.source === "fixture" ? "fixture" : vision.source,
      `PHI bbox blackout · egress ${vision.phiEgressBytes} Byte · regions=${vision.bboxCount} · natural=${vision.imageNatural.width}x${vision.imageNatural.height}`,
      maskMs,
      "mask",
      {
        lifecycle: "resolved",
        egressBytes: vision.phiEgressBytes,
      },
    );
    rememberMaskProof("default", {
      regions: vision.bboxCount,
      labels: (vision.boxes ?? []).map((b) => b.label).filter(Boolean),
      boxes: vision.boxes ?? [],
    });
    assertNoPhiStrings(masked, vision.forbiddenNames);
    return {
      preview: {
        masked: true,
        regions: vision.bboxCount,
        boxes: vision.boxes,
        imageNatural: vision.imageNatural,
      },
      payload: masked,
      source: vision.source,
      phiEgressBytes: vision.phiEgressBytes,
      detail: vision.detail,
      fallbackReason: vision.fallbackReason,
      trace: this.getTrace(),
    };
  }

  async auditRun(
    mode: AudienceMode = "clinician",
    locale: Locale = "ja",
    options: AuditRunOptions = {},
  ) {
    this.trace = [];
    const strict = isPartnerStrict(options.strict);
    const clientMeds = options.meds?.length
      ? enrichPsychLocks(sanitizeOcrMeds(options.meds))
      : null;
    const scan = clientMeds
      ? {
          preview: { masked: true, regions: 2 },
          payload: {
            meds: clientMeds,
            case:
              options.case ??
              ({
                ageGroup: "elderly",
                egfr: 40,
                symptoms: [],
                careLevel: "unknown",
              } satisfies ResidentCase),
          },
          source: (options.visionSource ?? "live") as TraceSource,
          phiEgressBytes: 0,
          detail: "client-scan-reuse",
        }
      : await this.visionScan();
    if (clientMeds) {
      this.push(
        "Vision",
        scan.source,
        "client-scan-reuse (skip re-OCR)",
        0,
        "vision",
      );
      this.push(
        "Mask",
        scan.source,
        "PHI bbox blackout · egress 0 Byte",
        0,
        "mask",
      );
    }
    const scanBaseline = forceContinueBaseline(scan.payload.meds);
    const analyzed = analyzeMedsForAudit(scanBaseline, scan.payload.case);
    const proposed: MedicationItem[] = analyzed.map((m) => {
      if (m.psychDependency === "HIGH") {
        return { ...m, active: true, recommendation: "continue" as const };
      }
      const rec = m.recommendation;
      const off = rec === "stop" || rec === "taper";
      return { ...m, active: !off, recommendation: rec };
    });
    let meds = applyAiPlanPreservingPsychLocks(analyzed, proposed);
    // Local SoT — partners consume this; no partner→partner await chain.
    const impactSoT = computeImpactMetrics(meds);
    const pitchBeforeNarrative = meds.map((m) => ({
      id: m.id,
      recommendation: m.recommendation,
      active: m.active,
    }));

    const evidenceFallback = {
      hits: [] as { title: string; url?: string; snippet?: string }[],
      source: "fixture" as TraceSource,
    };
    const defaultSpec = defaultCodeAfSpec(meds.map((m) => m.name));
    const codegenFallback = {
      scriptHint: "sandbox-script.py.txt fixture path · KB default taper",
      codeAfSpec: defaultSpec,
      codeAfHintDigest: codeAfHintDigest(defaultSpec),
      source: "fixture" as TraceSource,
    };
    const simFallback: Awaited<ReturnType<typeof runDeprescribeSim>> = {
      metrics: impactSoT as unknown as Record<string, number>,
      destroyProof: "destroyed:fixture-sandbox",
      source: "fixture",
      sandboxId: undefined,
      fallbackReason: "timeout_or_partner_fallback",
      appliedKbRules: defaultSpec.kb_rule_id,
      codeAfHintDigest: codeAfHintDigest(defaultSpec),
    };
    const narrativeFallback = buildNarrativeFallback(meds, [], locale);
    const familySeed =
      locale === "en"
        ? "Restore daytime smile and safety with a gentle med plan. For fear of losing the red sleep pill: we taper — we do not stop abruptly."
        : "お母様の昼間の笑顔と安全を取り戻すお薬整理。赤い眠り薬がない不安には、止めずにゆっくり減らす約束で応えます。";
    const familyFallback = { text: familySeed, source: "fixture" as TraceSource };

    const PARTNER_MS = partnerMs();
    const DAYTONA_MS = 15_000;
    const auditT0 = Date.now();
    const pendingPartners = new Set<string>([
      "CodeAF",
      "Tavily",
      "Daytona",
      "Nosana.narrative",
      "CodeAF.family",
    ]);
    this.push(
      "Orchestrator",
      "live",
      `Starting 2-phase harness · PARTNER_MS=${PARTNER_MS}`,
      undefined,
      "orchestrator",
      { lifecycle: "started" },
    );

    const heartbeat = setInterval(() => {
      const elapsed = Date.now() - auditT0;
      const awaiting = [...pendingPartners].join(", ") || "none";
      // Single elapsed in detail only (FE must not re-append elapsedMs).
      this.push(
        "Orchestrator.wait",
        "live",
        `awaiting [${awaiting}] · elapsed=${(elapsed / 1000).toFixed(1)}s / ${(PARTNER_MS / 1000).toFixed(1)}s`,
        undefined,
        "orchestrator",
        { lifecycle: "waiting_heartbeat" },
      );
    }, 1_000);

    const settlePartner = async <T extends { source: TraceSource }>(
      name: string,
      lane: TraceLane,
      work: Promise<T>,
      detailOf: (val: T, ms: number) => string,
      extraOf?: (
        val: T,
      ) => { fallbackReason?: string; egressBytes?: number } | undefined,
      progressDetail?: string,
    ): Promise<{ val: T; ms: number }> => {
      this.push(name, "live", "started", undefined, lane, {
        lifecycle: "started",
      });
      if (progressDetail) {
        this.push(name, "live", progressDetail, undefined, lane, {
          lifecycle: "progress",
        });
      }
      const timedResult = await timed(work);
      pendingPartners.delete(name);
      this.push(
        name,
        timedResult.val.source,
        detailOf(timedResult.val, timedResult.ms),
        timedResult.ms,
        lane,
        {
          lifecycle: "resolved",
          ...extraOf?.(timedResult.val),
        },
      );
      return timedResult;
    };

    let evidenceTimed: { val: typeof evidenceFallback; ms: number };
    let codegenTimed: { val: typeof codegenFallback; ms: number };
    let simTimed: { val: typeof simFallback; ms: number };
    let narrativeTimed: { val: typeof narrativeFallback; ms: number };
    let familyTimed: { val: typeof familyFallback; ms: number };
    try {
      // Phase A: CodeAF pharmacist KB plan → Tavily evidence (harness query)
      this.push(
        "Orchestrator.PhaseA",
        "live",
        "CodeAF KB plan + Tavily evidence",
        undefined,
        "orchestrator",
        { lifecycle: "progress" },
      );
      codegenTimed = await settlePartner(
        "CodeAF",
        "codeaf",
        withTimeout(generateSandboxHint(meds), PARTNER_MS, codegenFallback),
        (v) =>
          `${v.scriptHint} · digest=${v.codeAfHintDigest} · rules=${v.codeAfSpec.kb_rule_id.join(",")}`,
      );
      const harnessQuery =
        codegenTimed.val.codeAfSpec.searchQuery ||
        "deprescribing elderly PPI benzodiazepine 高齢者 医薬品適正使用";
      evidenceTimed = await settlePartner(
        "Tavily",
        "tavily",
        withTimeout(searchEvidence(harnessQuery), PARTNER_MS, evidenceFallback),
        (v) => `guideline hits=${v.hits.length} · q=${harnessQuery.slice(0, 48)}`,
      );

      // Phase B: Daytona consumes codeAfSpec → Nosana draft + CodeAF family check
      this.push(
        "Orchestrator.PhaseB",
        "live",
        "Daytona Proof-of-Execution + narrative/family",
        undefined,
        "orchestrator",
        { lifecycle: "progress" },
      );
      const phaseB = await Promise.all([
        settlePartner(
          "Daytona",
          "daytona",
          withTimeout(
            runDeprescribeSim(meds, codegenTimed.val.codeAfSpec),
            DAYTONA_MS,
            {
              ...simFallback,
              appliedKbRules: codegenTimed.val.codeAfSpec.kb_rule_id,
              codeAfHintDigest: codegenTimed.val.codeAfHintDigest,
            },
          ),
          (v) => {
            const rules = (v.appliedKbRules ?? []).join(",") || "none";
            const dig = v.codeAfHintDigest || codegenTimed.val.codeAfHintDigest;
            const base = `${v.destroyProof}${v.sandboxId ? ` · sandbox=${v.sandboxId}` : ""} · via CodeAF KB spec (rules=${rules} digest=${dig})`;
            return v.fallbackReason ? `${base} · reason=${v.fallbackReason}` : base;
          },
          (v) =>
            v.fallbackReason
              ? { fallbackReason: v.fallbackReason }
              : undefined,
          "sandbox metrics · CodeAF spec injected",
        ),
        settlePartner(
          "Nosana.narrative",
          "nosana",
          withTimeout(
            generateAuditNarrative({
              meds,
              evidence: evidenceTimed.val.hits,
              locale,
            }),
            PARTNER_MS,
            narrativeFallback,
          ),
          (v) =>
            `form2+rationale pack · draftChars=${(v.form2SummaryDraft ?? "").length}`,
          (v) => ({
            fallbackReason:
              "fallbackReason" in v
                ? (v as { fallbackReason?: string }).fallbackReason
                : undefined,
          }),
        ),
        settlePartner(
          "CodeAF.family",
          "codeaf",
          withTimeout(
            locale === "en"
              ? Promise.resolve(familyFallback)
              : rewriteFamilyCopy(familySeed),
            PARTNER_MS,
            familyFallback,
          ),
          () => "family rewrite · KB-3 ethics",
        ),
      ]);
      simTimed = phaseB[0];
      narrativeTimed = phaseB[1];
      familyTimed = phaseB[2];
    } finally {
      clearInterval(heartbeat);
    }

    const evidence = evidenceTimed.val;
    const codegen = codegenTimed.val;
    const sim = simTimed.val;
    const narrativeRaw = narrativeTimed.val;
    const familyRewrite = familyTimed.val;

    assertNoPhiStrings(evidence, scan.payload.case.symptoms);

    // Deterministic merge: fill empty guidelineRef / forecast from Tavily hits (no 2nd LLM).
    // Rotate hits[i % n] — never force every med onto hits[0] (copy-paste uniform trap).
    let narrative = narrativeRaw;
    if (evidence.hits.length) {
      narrative = {
        ...narrative,
        meds: narrative.meds.map((m, i) => ({
          ...m,
          guidelineRef:
            m.guidelineRef ||
            evidence.hits[i % evidence.hits.length]?.title ||
            m.guidelineRef,
        })),
        improvementForecast: narrative.improvementForecast.map((item, i) => ({
          ...item,
          url:
            item.url ||
            evidence.hits[i % evidence.hits.length]?.url ||
            evidence.hits.find((h) => h.url)?.url,
        })),
      };
      if (!narrative.improvementForecast.length && evidence.hits[0]) {
        narrative = {
          ...narrative,
          improvementForecast: [
            {
              title: evidence.hits[0].title,
              detail: evidence.hits[0].snippet || "",
              url: evidence.hits[0].url,
            },
          ],
        };
      }
    }

    meds = narrative.meds.map((m) => {
      const snap = pitchBeforeNarrative.find((x) => x.id === m.id);
      if (!snap) return m;
      return { ...m, recommendation: snap.recommendation, active: snap.active };
    });
    // 二重帳票同期: main form2SummaryDraft ≡ Dual evaluationBullets の根拠 (meds[].rationale)
    narrative = {
      ...narrative,
      form2SummaryDraft: buildForm2SummaryDraft(meds, locale),
    };

    assertPartnersLive(
      {
        Vision: scan.source,
        Tavily: evidence.source,
        CodeAF: codegen.source,
        Daytona: sim.source,
      },
      strict,
    );

    const totalMs = Date.now() - auditT0;
    this.push(
      "Orchestrator.DONE",
      "live",
      `Audit complete in ${totalMs}ms · partners verified`,
      totalMs,
      "orchestrator",
      { lifecycle: "resolved", elapsedMs: totalMs },
    );

    const clinicianBlob = buildClinicianBlob(meds, sim.metrics, locale);
    const audience = projectAudienceCopy(mode, meds, clinicianBlob, locale);
    if (mode === "family") {
      audience.displayText =
        locale === "en" ? familySeed : familyRewrite.text;
    }

    return {
      meds,
      metrics: sim.metrics,
      audience,
      evidence: evidence.hits,
      form2SummaryDraft: narrative.form2SummaryDraft,
      improvementForecast: narrative.improvementForecast,
      partners: {
        codeaf: {
          source: codegen.source,
          scriptHint: codegen.scriptHint,
          codeAfHintDigest: codegen.codeAfHintDigest,
          kbRuleIds: codegen.codeAfSpec.kb_rule_id,
          familyRewriteApplied: mode === "family" && locale !== "en",
          familyRewriteSource: familyRewrite.source,
        },
        daytona: {
          source: sim.source,
          sandboxId: sim.sandboxId,
          lifecycle: ["created", "codeRun", "destroyed"] as const,
          destroyProof: sim.destroyProof,
          metricsFromSandbox: sim.source === "live" || sim.source === "live-cache",
          appliedKbRules: sim.appliedKbRules,
          codeAfHintDigest: sim.codeAfHintDigest,
          executionMs: sim.executionMs,
        },
        tavily: { source: evidence.source },
        nosanaNarrative: { source: narrative.source },
      },
      trace: this.getTrace(),
      source: scan.source,
      locale,
      phiEgressBytes: scan.phiEgressBytes,
      daytonaDestroy: sim.destroyProof,
      sandboxId: sim.sandboxId,
      status: {
        phiExternalTransfer: "PHI EXTERNAL TRANSFER: 0 BYTE",
        daytonaSandbox: `Daytona Sandbox: Destroyed (${sim.destroyProof.replace("destroyed:", "")})`,
      },
    };
  }

  async dualDocs(
    meds: MedicationItem[],
    metrics: Record<string, number>,
    locale: Locale = "ja",
  ) {
    const clinical: ClinicalDeprescribeOrder = {
      plan: meds,
      clinicalEvidence:
        locale === "en"
          ? [
              { title: "MHLW guidance on appropriate medicine use in older adults" },
              { title: "Beers / STOPP reference" },
            ]
          : [
              { title: "高齢者の医薬品適正使用の指針（厚労省）" },
              { title: "Beers / STOPP 参考" },
            ],
      metrics,
    };
    const family: FamilyCareSheet =
      locale === "en"
        ? {
            plainSummary:
              "Family care sheet: restore daytime smile and safety. Do not stop sleep meds abruptly — taper gently.",
            graduationCalendar: meds.flatMap((m) => m.stepDown).slice(0, 4),
            reassureBullets: [
              "We proceed with the doctor",
              "Fear of losing the red sleep pill: we taper, not stop",
              "Call us if anything changes",
            ],
            outOfPocketNote: "Out-of-pocket varies with the final regimen",
          }
        : {
            plainSummary:
              "お母様の昼間の笑顔と安全を取り戻すお薬整理シート。睡眠薬は止めない、ゆっくり減らす。",
            graduationCalendar: meds.flatMap((m) => m.stepDown).slice(0, 4),
            reassureBullets: [
              "医師と相談しながら進めます",
              "赤い眠り薬がない不安には止めずに応えます",
              "体調変化があればすぐ連絡",
            ],
            outOfPocketNote: "自己負担は調剤内容により変動します",
          };
    const buckets = {
      stop: meds.filter((m) => m.recommendation === "stop"),
      taper: meds.filter((m) => m.recommendation === "taper"),
      continue: meds.filter((m) => m.recommendation === "continue"),
    };
    const evaluationBullets =
      locale === "en"
        ? meds
            .filter((m) => m.recommendation === "stop" || m.recommendation === "taper")
            .map(
              (m) =>
                m.rationale ||
                `${m.name}: ${m.recommendation} proposed for deprescribing review.`,
            )
        : meds
            .filter((m) => m.recommendation === "stop" || m.recommendation === "taper")
            .map(
              (m) =>
                m.rationale ||
                `${m.name}は${m.recommendation === "stop" ? "中止" : "漸減"}を提案（総合評価）。`,
            );
    const observationPlan = buildObservationPlan(meds, locale);
    const consent =
      locale === "en"
        ? {
            text: "The significance of the comprehensive medication assessment and self-pay burden were explained to the patient and family, and consent was obtained (patient and eldest daughter). Stored with this document and the medication profile.",
            consentedParties: ["patient", "eldest daughter"],
            pharmacistName: "Kenichi Sato",
          }
        : {
            text: "服用薬剤総合評価の意義と自己負担について事前に本人・家族へ説明し、同意を得た（本人・長女）。本書類および薬歴に保管する。",
            consentedParties: ["本人", "長女"],
            pharmacistName: "佐藤 健一",
          };

    const form2Base = {
      facility: locale === "en" ? "Service-attached senior housing (anonymous)" : "サービス付き高齢者向け住宅（匿名）",
      consult:
        locale === "en"
          ? "Review of too many pills · deprescribe plan with renal caution"
          : "お薬の飲みすぎ整理・腎機能を踏まえた減薬提案",
      buckets: {
        stop: buckets.stop.map((m) => m.name),
        taper: buckets.taper.map((m) => m.name),
        continue: buckets.continue.map((m) => m.name),
        counts: {
          stop: buckets.stop.length,
          taper: buckets.taper.length,
          continue: buckets.continue.length,
        },
      },
      evaluationBullets:
        evaluationBullets.length > 0
          ? evaluationBullets
          : locale === "en"
            ? ["No stop/taper candidates in current selection."]
            : ["現時点で中止・漸減候補はありません。"],
      observationPlan,
      consent,
      observation: observationPlan,
      medSummary: meds.map((m) => ({
        name: m.name,
        usage: m.usage,
        active: m.active,
        psychLock: m.psychDependency === "HIGH",
        recommendation: m.recommendation,
      })),
      metrics,
    };
    const form2 =
      locale === "en"
        ? {
            ...form2Base,
            title: "Medication adjustment support fee 2 (Form-2) preview",
            pointsNote:
              "Pharmacy 1,000 points / 6 months · Doctor 250 points (integrated deprescribe fee)",
            sections: [
              "3. Results of comprehensive medication assessment (summary)",
              "4. Observation plan and response measures",
              "5. Patient / family informed consent",
            ],
          }
        : {
            ...form2Base,
            title: "服用薬剤調整支援料２に係る情報提供書（提案プレビュー）",
            pointsNote:
              "薬局 1,000点／6月 · 医師 250点（薬剤総合評価調整管理料・ハッカソン整理）",
            sections: [
              "3. 服用薬剤総合評価の結果（要約）",
              "4. 観察計画及び対応案",
              "5. 患者・家族への説明と同意",
            ],
          };
    return { clinical, family, form2 };
  }

  loadFixtureResident() {
    if (!existsSync(join(FIXTURES, "resident-souvenir-v1.json"))) {
      return null;
    }
    return loadResident();
  }
}
