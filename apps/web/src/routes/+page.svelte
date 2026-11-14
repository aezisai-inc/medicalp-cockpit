<script lang="ts">
  import AudienceModeSwitch from "$lib/components/AudienceModeSwitch.svelte";
  import LocaleSwitch from "$lib/components/LocaleSwitch.svelte";
  import ScanButton from "$lib/components/ScanButton.svelte";
  import MaskPreview from "$lib/components/MaskPreview.svelte";
  import MedList, { type Med } from "$lib/components/MedList.svelte";
  import Form2MedTable from "$lib/components/Form2MedTable.svelte";
  import Form2SummaryEditor from "$lib/components/Form2SummaryEditor.svelte";
  import ImprovementForecast from "$lib/components/ImprovementForecast.svelte";
  import DualDocumentModal from "$lib/components/DualDocumentModal.svelte";
  import PartnerProofPanel from "$lib/components/PartnerProofPanel.svelte";
  import AgentConsoleLog, {
    type ConsoleLine,
  } from "$lib/components/AgentConsoleLog.svelte";
  import PartnerServiceBadge, {
    type PartnerSource,
  } from "$lib/components/PartnerServiceBadge.svelte";
  import SectionConsoleBox from "$lib/components/SectionConsoleBox.svelte";
  import PartnerStatusDock, {
    type PartnerDockState,
    type PartnerLane,
  } from "$lib/components/PartnerStatusDock.svelte";
  import { applyRecommendationActives, computeImpactMetrics } from "$lib/impact-metrics";
  import { getLocale, type Locale } from "$lib/i18n/locale";
  import { t } from "$lib/i18n/t";
  import { get } from "svelte/store";

  type TraceEvent = {
    step: string;
    source: string;
    detail?: string;
    at?: string;
    durationMs?: number;
    lane?: string;
    lifecycle?: string;
    elapsedMs?: number;
    fallbackReason?: string;
    egressBytes?: number;
  };

  type PhiBox = { label: string; x: number; y: number; w: number; h: number };
  type ImageNatural = { width: number; height: number };

  let audienceMode: "clinician" | "family" = $state("clinician");
  let meds: Med[] = $state([]);
  let egfr: number | null = $state(null);
  let metrics: Record<string, number> = $state({});
  let scanTrace: TraceEvent[] = $state([]);
  let auditTrace: TraceEvent[] = $state([]);
  let consoleRunning: ConsoleLine[] = $state([]);
  let trace: TraceEvent[] = $state([]);
  let preview: {
    masked: boolean;
    regions: number;
    boxes?: PhiBox[];
    imageNatural?: ImageNatural;
  } | null = $state(null);
  let maskBoxes: PhiBox[] = $state([]);
  let maskNatural: ImageNatural = $state({ width: 1240, height: 1754 });
  let maskProof: {
    regions: number;
    egress: number;
    labels: string[];
    sha256: string;
  } | null = $state(null);
  let clearBusy = $state(false);
  let dual: any = $state(null);
  let displayText = $state("");
  let familyView: {
    gentleGraduationTitle?: string;
    monthlyOutOfPocketCopy?: string;
  } | null = $state(null);
  let busy = $state(false);
  let error = $state("");
  let phase = $state<"idle" | "scanned" | "proposed" | "audited">("idle");
  let maskPhase = $state<"idle" | "scanning" | "masked" | "purged">("idle");
  let scanStatus = $state("");
  let dualOpen = $state(false);
  let evidence: { title: string; url?: string; snippet?: string }[] = $state([]);
  let form2Summary = $state("");
  let improvementForecast: { title: string; detail: string; url?: string }[] = $state([]);
  let proposedMeds: Med[] | null = $state(null);
  let approved = $state(false);
  let pharmacistApproved = $state(false);
  let doctorApproved = $state(false);
  let familyConsented = $state(false);
  let facilityFeeMode = $state<"fee_for_service" | "bundled">("fee_for_service");
  let cachedDualDocs = $state<any>(null);
  let audienceCache = $state<{
    clinicianDisplay: string;
    familyDisplay: string;
    familyView: { gentleGraduationTitle?: string; monthlyOutOfPocketCopy?: string } | null;
  } | null>(null);
  let timerMs = $state(0);
  let timerLabel = $state("");
  let statusPhi = $state("PHI EXTERNAL TRANSFER: 0 BYTE");
  let statusDaytona = $state("Daytona Sandbox: —");
  let lastAudit: any = $state(null);
  let logoTaps = $state(0);
  let scanPreviewUrl = $state("/fixtures/paper-scan/souvenir-notebook-v1.jpg");
  let scanSummary = $state("");
  let scanCase: Record<string, unknown> | null = $state(null);
  let scanSource = $state("");
  let partnerDock: PartnerDockState = $state({
    vision: "idle",
    mask: "idle",
    tavily: "idle",
    codeaf: "idle",
    daytona: "idle",
  });

  const api = (path: string, init?: RequestInit) =>
    fetch(path, { headers: { "Content-Type": "application/json" }, ...init });

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function forceContinueBaseline(list: Med[]): Med[] {
    return list.map((m) => ({
      ...m,
      recommendation: "continue",
      active: true,
    }));
  }

  const FORM2_HEADING = "薬剤調整総合評価（様式2たたき台）:";

  function isForm2HeadingOnly(text: string): boolean {
    const t = (text || "").trim();
    if (!t) return true;
    return t === FORM2_HEADING || t === "薬剤調整総合評価（様式2たたき台）：";
  }

  function buildForm2FallbackFromMeds(list: Med[]): string {
    const stopTaper = list.filter(
      (m) => m.recommendation === "stop" || m.recommendation === "taper",
    );
    const cont = list.filter((m) => m.recommendation === "continue").length;
    const locked = list.filter((m) => m.psychDependency === "HIGH").length;
    const lines = stopTaper.map(
      (m) =>
        `・${m.name}（${m.recommendation === "stop" ? "中止" : "漸減"}）: ${m.rationale || ""}`,
    );
    if (!lines.length) {
      lines.push(
        `・監査前ベースライン: 継続 ${cont} 剤` +
          (locked ? `／依存ロック ${locked} 剤は急な中止を回避` : "") +
          "。監査オーケストレーション結果を様式2に反映してください。",
      );
    } else if (cont || locked) {
      lines.push(
        `・継続 ${cont} 剤` +
          (locked ? `（うち依存ロック ${locked}）` : "") +
          "は経過観察。",
      );
    }
    return [FORM2_HEADING, ...lines].join("\n");
  }

  function ensureForm2Filled() {
    if (!isForm2HeadingOnly(form2Summary)) return;
    form2Summary = buildForm2FallbackFromMeds(listMeds.length ? listMeds : meds);
  }

  function tt(key: import("$lib/i18n/messages/ja").MessageKey, vars?: Record<string, string | number>) {
    return get(t)(key, vars);
  }

  function asLane(source?: string): PartnerLane {
    if (source === "live" || source === "live-cache" || source === "fixture") {
      return source;
    }
    return "error";
  }

  function elapsedOf(at?: string, baseMs?: number): string {
    if (!at) return "--:--.---";
    const t0 = baseMs ?? Date.parse(at);
    const ms = Math.max(0, Date.parse(at) - t0);
    const mm = String(Math.floor(ms / 60000)).padStart(2, "0");
    const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const mmm = String(ms % 1000).padStart(3, "0");
    return `${mm}:${ss}.${mmm}`;
  }

  function mergeTraces(scan: TraceEvent[], audit: TraceEvent[]): TraceEvent[] {
    const partners = audit.filter((e) => {
      const lane = (e.lane || "").toLowerCase();
      if (lane === "vision" || lane === "mask") return false;
      const step = e.step.toLowerCase();
      return step !== "vision" && step !== "mask";
    });
    return [...scan, ...partners];
  }

  function toConsoleLines(events: TraceEvent[]): ConsoleLine[] {
    const base = events[0]?.at ? Date.parse(events[0].at) : Date.now();
    return events.map((ev, i) => {
      const src =
        ev.source === "live" ||
        ev.source === "live-cache" ||
        ev.source === "fixture"
          ? ev.source
          : ("info" as const);
      const life = ev.lifecycle ? `[${ev.lifecycle}] ` : "";
      const reason = ev.fallbackReason ? ` · reason=${ev.fallbackReason}` : "";
      const detail = ev.detail ?? "";
      // Avoid elapsed= double-append when orchestrator already embeds elapsed in detail.
      const elapsedHint =
        ev.elapsedMs != null && !/elapsed=/.test(detail)
          ? ` · elapsed=${(ev.elapsedMs / 1000).toFixed(1)}s`
          : "";
      return {
        id: `${ev.step}-${i}-${ev.at ?? i}-${ev.lifecycle ?? ""}`,
        elapsed: elapsedOf(ev.at, base),
        step: ev.step,
        source: src,
        message: `${life}${detail}${reason}${elapsedHint}`,
        durationMs: ev.durationMs,
        running: ev.lifecycle === "waiting_heartbeat" || ev.lifecycle === "progress",
      };
    });
  }

  function formatElapsed(ms: number): string {
    const ss = String(Math.floor(ms / 1000)).padStart(2, "0");
    const mmm = String(ms % 1000).padStart(3, "0");
    return `00:${ss}.${mmm}`;
  }

  /** Lambda BUFFERED hybrid: client 1s heartbeat until SSE chunks overwrite. */
  async function consumeAuditSse(
    res: Response,
    onProgress: (ev: TraceEvent) => void,
  ): Promise<any> {
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream") || !res.body) {
      return res.json();
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: any = null;
    let eventName = "message";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let data = "";
        eventName = "message";
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (eventName === "progress") onProgress(parsed as TraceEvent);
        else if (eventName === "result") result = parsed;
        else if (eventName === "error") {
          throw new Error(
            parsed?.message || parsed?.payload?.message || `audit stream error`,
          );
        }
      }
    }
    if (!result) throw new Error("audit stream ended without result");
    return result;
  }

  function mirrorAriaAgent(events: TraceEvent[]) {
    for (const ev of events) console.info("[AriaAgent]", ev);
  }

  function applyTraceToDock(
    events: TraceEvent[],
    opts?: { error?: boolean; sandboxId?: string },
  ) {
    const next: PartnerDockState = {
      vision: "idle",
      mask: "idle",
      tavily: "idle",
      codeaf: "idle",
      daytona: "idle",
    };
    for (const ev of events) {
      const lane = opts?.error ? "error" : asLane(ev.source);
      const step = (ev.step || "").toLowerCase();
      if (step.includes("vision")) {
        next.vision = lane;
        const d = (ev.detail || "").toLowerCase();
        if (d.includes("nosana")) {
          next.visionLabel = "Nosana GPU Vision";
        } else if (d.includes("via:codeaf") || d.includes("via: codeaf") || d.includes("codeaf")) {
          next.visionLabel = lane === "live" ? "LIVE (CodeAF Vision)" : "CodeAF Vision";
        }
      } else if (step.includes("mask")) {
        next.mask = lane === "error" ? "error" : lane === "idle" ? "idle" : "live";
      } else if (step.includes("tavily")) {
        next.tavily = lane;
      } else if (step.includes("codeaf")) {
        next.codeaf = lane;
      } else if (step.includes("daytona")) {
        next.daytona = lane;
        const id =
          opts?.sandboxId ||
          (ev.detail?.startsWith("destroyed:")
            ? ev.detail.replace("destroyed:", "").slice(0, 8)
            : undefined);
        if (id) next.daytonaDetail = id;
      }
    }
    if (opts?.error) {
      for (const k of ["vision", "mask", "tavily", "codeaf", "daytona"] as const) {
        if (next[k] === "idle") next[k] = "error";
      }
    }
    partnerDock = next;
  }

  function markDockRunning(kind: "scan" | "audit") {
    if (kind === "scan") {
      partnerDock = {
        ...partnerDock,
        vision: "running",
        mask: "running",
      };
      return;
    }
    partnerDock = {
      vision: "running",
      mask: "running",
      tavily: "running",
      codeaf: "running",
      daytona: "running",
      visionLabel: undefined,
      daytonaDetail: undefined,
    };
  }

  function applyAuditPayload(data: any, mode: "clinician" | "family") {
    const raw = (data.meds ?? []) as Med[];
    const list = applyRecommendationActives(raw);
    proposedMeds = list;
    meds = list;
    // Normalized actives → Impact SoT (AFTER 18% / 1095 / 68400 when pitch matrix ON).
    metrics = list.length ? computeImpactMetrics(list) : (data.metrics ?? {});
    auditTrace = data.trace ?? [];
    trace = mergeTraces(scanTrace, auditTrace);
    consoleRunning = [];
    mirrorAriaAgent(trace);
    evidence = data.evidence ?? [];
    form2Summary = data.form2SummaryDraft ?? form2Summary;
    improvementForecast = data.improvementForecast ?? [];
    displayText = data.audience?.displayText ?? "";
    familyView = data.audience?.family ?? null;
    statusPhi = data.status?.phiExternalTransfer ?? "PHI EXTERNAL TRANSFER: 0 BYTE";
    statusDaytona = data.status?.daytonaSandbox ?? "Daytona Sandbox: Destroyed";
    lastAudit = { ...data, meds: list, metrics };
    if (!preview) preview = { masked: true, regions: 2 };
    maskPhase = "masked";
    approved = false;
    pharmacistApproved = false;
    doctorApproved = false;
    familyConsented = false;
    phase = "proposed";
    applyTraceToDock(trace, { sandboxId: data.sandboxId });
    void hydrateAudienceCache(data);
  }

  function buildFamilyAudienceFromDual(dualPayload: any) {
    const familyView = {
      gentleGraduationTitle: tt("graduationTitle"),
      monthlyOutOfPocketCopy: dualPayload?.family?.outOfPocketNote ?? tt("pocketNote"),
    };
    const displayText = [
      dualPayload?.family?.plainSummary ?? tt("afterFamily"),
      familyView.gentleGraduationTitle,
      tt("lockPromise"),
      familyView.monthlyOutOfPocketCopy,
    ].join("\n");
    return { displayText, familyView };
  }

  function applyAudienceLocal(mode: "clinician" | "family") {
    audienceMode = mode;
    if (!audienceCache) return;
    if (mode === "clinician") {
      displayText = audienceCache.clinicianDisplay;
      familyView = null;
      return;
    }
    displayText = audienceCache.familyDisplay;
    familyView = audienceCache.familyView;
  }

  async function fetchDualPayload() {
    const res = await api("/api/docs/dual", {
      method: "POST",
      body: JSON.stringify({
        meds: proposedMeds ?? meds,
        metrics,
        locale: getLocale(),
      }),
    });
    if (!res.ok) throw new Error(`dual ${res.status}`);
    const payload = await res.json();
    if (form2Summary && payload?.form2) {
      return {
        ...payload,
        form2: {
          ...payload.form2,
          sections: form2Summary.split("\n").filter(Boolean),
        },
      };
    }
    return payload;
  }

  async function hydrateAudienceCache(data: any) {
    try {
      const dualPayload = await fetchDualPayload();
      cachedDualDocs = dualPayload;
      const fam = buildFamilyAudienceFromDual(dualPayload);
      audienceCache = {
        clinicianDisplay: data.audience?.displayText ?? displayText,
        familyDisplay: fam.displayText,
        familyView: fam.familyView,
      };
      applyAudienceLocal(audienceMode);
    } catch (e) {
      error = String(e);
    }
  }

  async function fileToJpegBase64(file: File): Promise<{ imageBase64: string; mimeType: string }> {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { imageBase64: dataUrl, mimeType: "image/jpeg" };
  }

  function buildMedSummary(list: Med[], caseObj?: { egfr?: number } | null): string {
    const names = list.map((m) => m.name).filter(Boolean);
    const head = names.slice(0, 2).join("・") || "抽出薬";
    const more = names.length > 2 ? "…" : "";
    const eg = caseObj?.egfr ?? egfr;
    return `${head}${more}（×${names.length || list.length}）${eg != null ? `／ eGFR ${eg}` : ""}`;
  }

  async function onScan(file?: File) {
    busy = true;
    error = "";
    maskPhase = "scanning";
    scanStatus = tt("scanVision");
    approved = false;
    pharmacistApproved = false;
    doctorApproved = false;
    familyConsented = false;
    cachedDualDocs = null;
    audienceCache = null;
    proposedMeds = null;
    consoleRunning = [
      {
        id: "run-vision",
        step: "Nosana.Vision",
        source: "running",
        message: "OCR in progress…",
        running: true,
      },
      {
        id: "run-mask",
        step: "Mask",
        source: "running",
        message: "PHI blackout pending…",
        running: true,
      },
    ];
    markDockRunning("scan");
    try {
      let body = "{}";
      if (file) {
        const packed = await fileToJpegBase64(file);
        if (scanPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(scanPreviewUrl);
        scanPreviewUrl = packed.imageBase64;
        body = JSON.stringify(packed);
      }
      const res = await api("/api/vision/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`scan ${res.status}`);
      const data = await res.json();
      preview = data.preview;
      maskBoxes = (data.preview?.boxes as PhiBox[] | undefined) ?? [];
      maskNatural =
        (data.preview?.imageNatural as ImageNatural | undefined) ??
        maskNatural;
      maskProof = null;
      meds = forceContinueBaseline(data.payload?.meds ?? []);
      scanCase = data.payload?.case ?? null;
      egfr = data.payload?.case?.egfr ?? null;
      scanSource = data.source ?? "";
      scanSummary = buildMedSummary(meds, data.payload?.case);
      form2Summary = "";
      improvementForecast = [];
      proposedMeds = null;
      metrics = meds.length ? computeImpactMetrics(meds) : {};
      maskPhase = "masked";
      scanStatus = tt("scanMasked", { n: preview?.regions ?? 0 });
      phase = "scanned";
      scanTrace = (data.trace as TraceEvent[] | undefined) ?? [];
      auditTrace = [];
      trace = mergeTraces(scanTrace, auditTrace);
      consoleRunning = [];
      mirrorAriaAgent(scanTrace);
      const src = asLane(data.source);
      partnerDock = {
        ...partnerDock,
        vision: src,
        mask: src === "fixture" ? "fixture" : src === "error" ? "error" : "live",
        visionLabel:
          data.detail?.includes("via:codeaf") || data.detail?.includes("via: codeaf")
            ? "LIVE (CodeAF Vision)"
            : undefined,
      };
      applyTraceToDock(trace);
      // Chain audit so CodeAF/Daytona/Tavily leave STANDBY after one scan action.
      form2Summary = tt("form2Generating");
      // MUST clear busy before nested onAuditStart — if (busy) return would no-op the chain.
      busy = false;
      await onAuditStart({ fromScan: true });
    } catch (e) {
      error = String(e);
      maskPhase = "idle";
      scanStatus = tt("scanFail");
      consoleRunning = [];
      partnerDock = { ...partnerDock, vision: "error", mask: "error" };
    } finally {
      busy = false;
    }
  }

  async function onAuditStart(opts?: { fromScan?: boolean }) {
    if (busy && !opts?.fromScan) return;
    busy = true;
    error = "";
    timerMs = 0;
    timerLabel = tt("timerAuditing");
    const liveProgress: TraceEvent[] = [];
    let serverChunks = 0;
    consoleRunning = [
      {
        id: "hb-client-0",
        step: "Orchestrator.wait",
        source: "running",
        message: "[waiting_heartbeat] elapsed=0.0s (client)",
        elapsed: formatElapsed(0),
        running: true,
      },
    ];
    markDockRunning("audit");
    const started = Date.now();
    const tick = setInterval(() => {
      timerMs = Date.now() - started;
    }, 50);
    /** CP-Lambda: 1s client heartbeat until first SSE chunk arrives / during BUFFERED wait. */
    const clientHb = setInterval(() => {
      const elapsed = Date.now() - started;
      const sec = (elapsed / 1000).toFixed(1);
      const startedSteps = new Set(
        liveProgress
          .filter((e) => e.lifecycle === "started")
          .map((e) => e.step),
      );
      const resolvedSteps = new Set(
        liveProgress
          .filter((e) => e.lifecycle === "resolved")
          .map((e) => e.step),
      );
      const awaiting = [...startedSteps]
        .filter((s) => !resolvedSteps.has(s) && s !== "Orchestrator")
        .slice(0, 4);
      const awaitHint = awaiting.length
        ? ` awaiting [${awaiting.join(", ")}]`
        : "";
      const hbLine: ConsoleLine = {
        id: `hb-client-${Math.floor(elapsed / 1000)}`,
        step: "Orchestrator.wait",
        source: "running",
        message: `[waiting_heartbeat]${awaitHint} · elapsed=${sec}s (client)`,
        elapsed: formatElapsed(elapsed),
        running: true,
      };
      if (serverChunks === 0) {
        consoleRunning = [hbLine];
      } else {
        const fromServer = toConsoleLines(liveProgress);
        consoleRunning = [
          ...fromServer.filter((l) => !l.id.startsWith("hb-client-")),
          hbLine,
        ];
      }
    }, 1000);
    try {
      const res = await api("/api/audit/run?stream=1", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audienceMode: "clinician",
          locale: getLocale(),
          stream: true,
          meds: meds.length ? meds : undefined,
          case: scanCase ?? undefined,
          caseSummary: scanCase ?? undefined,
          visionSource: scanSource || undefined,
        }),
      });
      // Keep minimum pitch UX wait, but still stream progress concurrently.
      const waitFloor = sleep(3000);
      if (!res.ok) {
        clearInterval(tick);
        clearInterval(clientHb);
        consoleRunning = [];
        applyTraceToDock(trace, { error: true });
        throw new Error(`audit ${res.status}`);
      }
      const dataPromise = consumeAuditSse(res, (ev) => {
        serverChunks += 1;
        liveProgress.push(ev);
        consoleRunning = toConsoleLines(liveProgress);
        auditTrace = [...liveProgress];
        trace = mergeTraces(scanTrace, auditTrace);
      });
      const [data] = await Promise.all([dataPromise, waitFloor]);
      clearInterval(tick);
      clearInterval(clientHb);
      timerMs = Math.max(3000, Date.now() - started);
      timerLabel = tt("timerDone", { s: (timerMs / 1000).toFixed(1) });
      applyAuditPayload(data, "clinician");
      ensureForm2Filled();
      if (egfr === null) egfr = 38;
    } catch (e) {
      clearInterval(tick);
      clearInterval(clientHb);
      error = String(e);
      consoleRunning = [];
      applyTraceToDock(trace, { error: true });
      timerLabel = tt("timerFail");
      ensureForm2Filled();
    } finally {
      busy = false;
    }
  }

  async function onClearImage() {
    clearBusy = true;
    error = "";
    try {
      const res = await api("/api/vision/clear", { method: "POST", body: "{}" });
      if (!res.ok) throw new Error(`clear ${res.status}`);
      const data = await res.json();
      if (scanPreviewUrl.startsWith("blob:") || scanPreviewUrl.startsWith("data:")) {
        if (scanPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(scanPreviewUrl);
      }
      scanPreviewUrl = "";
      maskBoxes = [];
      preview = data.preview ?? { masked: false, regions: 0, boxes: [] };
      // Proof Strip retains last scan regions/labels (API Wave A); never wipe if present.
      const incomingProof = data.proof as typeof maskProof;
      maskProof = {
        regions: Math.max(
          incomingProof?.regions ?? 0,
          maskProof?.regions ?? 0,
          preview?.regions ?? 0,
        ),
        egress: incomingProof?.egress ?? 0,
        labels:
          incomingProof?.labels?.length
            ? incomingProof.labels
            : (maskProof?.labels ?? []),
        sha256: incomingProof?.sha256 ?? "cleared",
      };
      maskPhase = "purged";
      scanStatus = tt("maskPurged");
      const purgeTrace = (data.trace as TraceEvent[] | undefined) ?? [];
      scanTrace = [...scanTrace, ...purgeTrace];
      trace = mergeTraces(scanTrace, auditTrace);
      consoleRunning = [];
      mirrorAriaAgent(purgeTrace);
    } catch (e) {
      error = String(e);
    } finally {
      clearBusy = false;
    }
  }

  function onPharmacistApprove() {
    if (!proposedMeds || pharmacistApproved) return;
    pharmacistApproved = true;
    void openDual();
  }

  function onDoctorApprove() {
    if (!proposedMeds || !pharmacistApproved || doctorApproved) return;
    meds = proposedMeds;
    approved = true;
    doctorApproved = true;
    phase = "audited";
    if (audienceMode === "clinician") {
      displayText = `${displayText}\n\n${tt("approveNote")}`;
      if (audienceCache) {
        audienceCache = {
          ...audienceCache,
          clinicianDisplay: displayText,
        };
      }
    }
    void openDual();
  }

  function onReject() {
    proposedMeds = null;
    approved = false;
    pharmacistApproved = false;
    doctorApproved = false;
    familyConsented = false;
    cachedDualDocs = null;
    audienceCache = null;
    phase = meds.length ? "scanned" : "idle";
    timerLabel = tt("timerReject");
  }

  async function openDual() {
    try {
      if (cachedDualDocs) {
        dual = cachedDualDocs;
      } else {
        dual = await fetchDualPayload();
        cachedDualDocs = dual;
      }
      dualOpen = true;
    } catch (e) {
      error = String(e);
    }
  }

  function switchMode(mode: "clinician" | "family") {
    applyAudienceLocal(mode);
  }

  function onLocaleChange(_loc: Locale) {
    if (audienceCache && cachedDualDocs) {
      const fam = buildFamilyAudienceFromDual(cachedDualDocs);
      audienceCache = {
        ...audienceCache,
        familyDisplay: fam.displayText,
        familyView: fam.familyView,
      };
      applyAudienceLocal(audienceMode);
    }
  }

  function toggleFacilityFeeMode() {
    facilityFeeMode = facilityFeeMode === "fee_for_service" ? "bundled" : "fee_for_service";
  }

  function setRecommendation(id: string, rec: "stop" | "taper" | "continue") {
    const target = approved ? meds : (proposedMeds ?? meds);
    const next = applyRecommendationActives(
      target.map((m) => {
        if (m.id !== id) return m;
        if (m.psychDependency === "HIGH" && rec === "stop") return m;
        return { ...m, recommendation: rec };
      }),
    );
    if (approved) meds = next;
    else if (proposedMeds) proposedMeds = next;
    else meds = next;
    metrics = { ...metrics, ...computeImpactMetrics(next) };
  }

  function rebuildForm2SummaryFromMeds() {
    form2Summary = buildForm2FallbackFromMeds(listMeds.length ? listMeds : meds);
  }

  function onLogoTap() {
    logoTaps += 1;
    if (logoTaps >= 2) {
      logoTaps = 0;
      if (lastAudit) {
        applyAuditPayload(lastAudit, audienceMode);
        meds = lastAudit.meds ?? meds;
        onDoctorApprove();
        timerLabel = tt("timerReplay");
      } else {
        onAuditStart().then(() => {
          onPharmacistApprove();
          onDoctorApprove();
        });
      }
    }
    setTimeout(() => {
      logoTaps = 0;
    }, 800);
  }

  const facilityRoi = $derived(Math.round(((metrics.costDelta ?? 0) * 100) / 10000));
  const riskBefore = $derived(metrics.fallRiskBefore ?? 88);
  const riskAfter = $derived(metrics.fallRiskAfter ?? Math.max(12, 100 - (metrics.riskDelta ?? 70)));
  const listMeds = $derived(proposedMeds ?? meds);
  const personaSummary = $derived(
    tt("personaSummary", {
      meds: listMeds.length || 9,
      daily: metrics.dailyDosesBefore ?? 4,
      egfr: egfr ?? 38,
    }),
  );
  const costBefore = $derived(metrics.costBefore ?? 0);
  const costAfter = $derived(metrics.costAfter ?? Math.max(0, costBefore - (metrics.costDelta ?? 0)));
  const forecastItems = $derived(
    improvementForecast.length
      ? improvementForecast
      : listMeds
          .filter((m) => m.recommendation === "stop" || m.recommendation === "taper")
          .map((m) => ({
            title: m.name,
            detail: m.expectedImprovement || m.rationale || "",
            url: evidence[0]?.url,
          })),
  );

  function partnerSrc(raw: unknown, fallback: PartnerSource = "idle"): PartnerSource {
    if (
      raw === "live" ||
      raw === "live-cache" ||
      raw === "fixture" ||
      raw === "idle" ||
      raw === "running" ||
      raw === "error"
    ) {
      return raw;
    }
    return fallback;
  }

  const codeafSource = $derived(
    partnerSrc(
      lastAudit?.partners?.codeaf?.source,
      partnerDock.codeaf === "live" || partnerDock.codeaf === "live-cache"
        ? partnerDock.codeaf
        : "idle",
    ),
  );
  const daytonaSource = $derived(
    partnerSrc(
      lastAudit?.partners?.daytona?.source,
      partnerDock.daytona === "live" || partnerDock.daytona === "live-cache"
        ? partnerDock.daytona
        : "idle",
    ),
  );
  const nosanaSource = $derived(
    partnerSrc(lastAudit?.partners?.nosanaNarrative?.source, "live"),
  );
  const tavilySource = $derived(
    partnerSrc(
      lastAudit?.partners?.tavily?.source,
      partnerDock.tavily === "live" || partnerDock.tavily === "live-cache"
        ? partnerDock.tavily
        : "idle",
    ),
  );
  const proofHint = $derived(String(lastAudit?.partners?.codeaf?.scriptHint ?? ""));
  const proofSandboxId = $derived(
    String(lastAudit?.partners?.daytona?.sandboxId ?? lastAudit?.sandboxId ?? ""),
  );
  const proofDestroy = $derived(
    String(lastAudit?.partners?.daytona?.destroyProof ?? lastAudit?.daytonaDestroy ?? ""),
  );
  const familyRewriteApplied = $derived(
    Boolean(lastAudit?.partners?.codeaf?.familyRewriteApplied),
  );
  const consoleLines = $derived([...toConsoleLines(trace), ...consoleRunning]);
  const incentiveVars = $derived({
    pharm: "1,000",
    md: "250",
    assist: (metrics.assistDelta ?? 0).toLocaleString(),
    riskBefore: riskBefore,
    riskAfter: riskAfter,
  });
</script>

<main class="cockpit mode-{audienceMode}" data-mode={audienceMode}>
  <header>
    <div>
      <p class="eyebrow">
        <button type="button" class="logo-tap" onclick={onLogoTap} aria-label="brand">Aezisai Cronias PoC</button>
        · Aria Care-Audit
      </p>
      <h1>{$t("title")}</h1>
      <p class="sub">{$t("subtitle")}</p>
      <div class="status-bar" data-testid="pitch-status">
        <code>{statusPhi}</code>
        <code>{statusDaytona}</code>
        {#if timerLabel}<span class="timer">{timerLabel}{timerMs ? ` (${timerMs}ms)` : ""}</span>{/if}
      </div>
    </div>
    <div class="header-actions">
      <LocaleSwitch disabled={busy} onChange={onLocaleChange} />
      <AudienceModeSwitch mode={audienceMode} disabled={busy} onSwitch={switchMode} />
      <button type="button" class="ai-btn" disabled={busy || phase === "idle"} onclick={() => onAuditStart()}>
        {$t("auditStart")}
      </button>
      <button
        type="button"
        class="approve-btn"
        disabled={busy || !proposedMeds || !pharmacistApproved || doctorApproved}
        onclick={onDoctorApprove}
      >
        {doctorApproved ? $t("doctorApprovedBadge") : $t("doctorApprove")}
      </button>
      <button type="button" class="reject-btn" disabled={busy || !proposedMeds || approved} onclick={onReject}>
        {$t("reject")}
      </button>
    </div>
  </header>

  <div class="cols viewport-3">
    <section class="panel glass">
      <h2 class="col-head">
        <span>{$t("col1")}</span>
        <span class="head-badges">
          <PartnerServiceBadge name="Nosana" label="Nosana Vision" source={partnerDock.vision} />
          <PartnerServiceBadge name="Nosana" label="PHI Mask" source={partnerDock.mask} />
        </span>
      </h2>
      <div class="scan-strip">
        <ScanButton busy={busy} status={scanStatus} onScan={onScan} />
        <MaskPreview
          visible={phase !== "idle" || maskPhase !== "idle"}
          phase={maskPhase}
          regionCount={preview?.regions ?? maskBoxes.length}
          imageSrc={scanPreviewUrl || null}
          summaryText={scanSummary}
          {personaSummary}
          boxes={maskBoxes}
          imageNatural={maskNatural}
          proof={maskProof}
          onClear={onClearImage}
          {clearBusy}
        />
        <SectionConsoleBox
          title="$ nosana-vision --ocr --phi-mask"
          lanes={["Scan.ingest", "Nosana.vision", "Mask.apply", "Mask.overlay", "Mask.purge"]}
          lines={consoleLines}
        />
      </div>

      {#if egfr !== null}
        <div class="resident">
          <div class="age">{$t("age")}</div>
          <div>
            <strong>{$t("residentTitle")}</strong>
            <span class="egfr">eGFR {egfr}</span>
            <p class="symptoms">{$t("symptoms")}</p>
          </div>
          <span class="phi-tag">PHI-Masking</span>
        </div>
      {/if}

      <MedList
        meds={listMeds}
        preAudit={phase === "scanned" && !proposedMeds}
        {audienceMode}
        pharmacistApproved={pharmacistApproved}
        audited={phase === "audited" || doctorApproved}
        dailyDosesBefore={metrics.dailyDosesBefore ?? 4}
        dailyDosesAfter={metrics.dailyDosesAfter ?? 1}
        onChangeRecommendation={setRecommendation}
        onPharmacistApprove={onPharmacistApprove}
      />
      {#if proposedMeds && !approved}
        <p class="propose-banner">{$t("proposeBanner")}</p>
      {/if}
      {#if doctorApproved}
        <p class="approve-banner">{$t("approveBanner")}</p>
      {/if}
    </section>

    <section class="panel glass impact">
      <h2 class="col-head">
        <span>{$t("col2")}</span>
        <span class="head-badges">
          <PartnerServiceBadge name="Daytona" source={partnerDock.daytona} />
          <PartnerServiceBadge name="CodeAF" source={partnerDock.codeaf} />
          <PartnerServiceBadge name="Nosana" label="Nosana LLM" source={busy ? "running" : nosanaSource} />
        </span>
      </h2>
      {#if phase === "proposed" || phase === "audited"}
        <div class="before-after risk-only" data-testid="risk-before-after">
          <article class="before">
            <div class="card-badges">
              <PartnerServiceBadge name="Daytona" label="Daytona Sandbox" source={partnerDock.daytona} />
            </div>
            <span class="tag rose">BEFORE</span>
            {#if audienceMode === "clinician"}
              <h3>{$t("beforeClinician", { n: riskBefore })}</h3>
            {:else}
              <h3>{$t("beforeFamily")}</h3>
            {/if}
            <div class="meter rose-bar"><span style={`width:${riskBefore}%`}></span></div>
          </article>
          <article class="after">
            <span class="tag teal">AFTER</span>
            {#if audienceMode === "clinician"}
              <h3>{$t("afterClinician", { n: riskAfter })}</h3>
            {:else}
              <h3>{$t("afterFamily")}</h3>
            {/if}
            <div class="meter teal-bar"><span style={`width:${riskAfter}%`}></span></div>
            <div class="stats">
              <div>
                {#if audienceMode === "clinician"}
                  <span>{$t("assistLabelClinician")}</span>
                {:else}
                  <span>{$t("assistLabelFamily")}</span>
                {/if}
                <strong>{$t("assistValue", { n: metrics.assistDelta ?? 0 })}</strong>
              </div>
            </div>
          </article>
        </div>
      {/if}

      {#if listMeds.length || phase === "scanned"}
        <div class="form2-head">
          <span class="head-badges">
            <PartnerServiceBadge name="CodeAF" source={partnerDock.codeaf} />
            <PartnerServiceBadge name="Nosana" label="Nosana LLM" source={busy ? "running" : nosanaSource} />
          </span>
        </div>
        <Form2MedTable meds={listMeds} />
        <Form2SummaryEditor
          value={form2Summary || displayText}
          onChange={(v) => (form2Summary = v)}
          onRegenerate={rebuildForm2SummaryFromMeds}
        />
        <SectionConsoleBox
          title="$ daytona · codeaf · nosana-llm"
          lanes={["Daytona", "CodeAF", "Nosana.narrative"]}
          lines={consoleLines}
        />
        {#if lastAudit?.partners}
          <PartnerProofPanel
            codeafHint={proofHint}
            {codeafSource}
            {familyRewriteApplied}
            {daytonaSource}
            sandboxId={proofSandboxId}
            destroyProof={proofDestroy}
            fallBefore={riskBefore}
            fallAfter={riskAfter}
          />
        {/if}
      {:else}
        <p class="copy">{displayText || $t("copyIdle")}</p>
      {/if}

      {#if audienceMode === "family" && familyView?.gentleGraduationTitle}
        <div class="calendar family-only" data-testid="graduation-calendar">
          <h4>{familyView.gentleGraduationTitle}</h4>
        </div>
      {/if}

      {#if audienceMode === "family"}
        <p class="promise family-only" data-testid="lock-promise">
          {$t("lockPromise")}
        </p>
      {/if}

      {#if audienceMode === "family" && (phase === "proposed" || phase === "audited")}
        <label class="consent-row" data-testid="family-consent">
          <input type="checkbox" bind:checked={familyConsented} />
          <span>{$t("familyConsent")}</span>
        </label>
        {#if familyConsented}
          <p class="consent-badge" data-testid="family-consent-badge">{$t("familyConsentBadge")}</p>
        {/if}
      {/if}

      {#if audienceMode === "clinician" && (phase === "proposed" || phase === "audited")}
        <p class="incentive" data-testid="incentive-strip">
          {$t("incentiveStrip", incentiveVars)}
        </p>
      {/if}

      <button type="button" class="dual-btn" disabled={phase !== "proposed" && phase !== "audited"} onclick={openDual}>{$t("dualBtn")}</button>
    </section>

    <section class="panel glass trace-panel">
      <h2 class="col-head">
        <span>{$t("col3")}</span>
        <span class="head-badges">
          <PartnerServiceBadge name="Daytona" source={partnerDock.daytona} />
          <PartnerServiceBadge name="Tavily" source={partnerDock.tavily} />
        </span>
      </h2>
      {#if phase === "proposed" || phase === "audited"}
        <div class="cost-ba" data-testid="cost-before-after">
          <article class="before">
            <div class="card-badges">
              <PartnerServiceBadge name="Daytona" source={partnerDock.daytona} />
            </div>
            <span class="tag rose">BEFORE</span>
            <span>{$t("costBeforeLabel")}</span>
            <strong>¥{costBefore.toLocaleString()}</strong>
          </article>
          <article class="after">
            <span class="tag teal">AFTER</span>
            <span>{$t("costAfterLabel")}</span>
            <strong>¥{costAfter.toLocaleString()}</strong>
            <p class="delta">
              {$t("costDeltaLabel")}: -¥{(metrics.costDelta ?? 0).toLocaleString()}
            </p>
            {#if audienceMode === "clinician" && facilityRoi > 0}
              <button
                type="button"
                class="fee-toggle"
                data-testid="facility-fee-mode"
                onclick={toggleFacilityFeeMode}
              >
                {facilityFeeMode === "fee_for_service"
                  ? $t("facilityFeeToggleFFS")
                  : $t("facilityFeeToggleBundled")}
              </button>
              <p class="roi-line" data-testid="facility-roi">
                {facilityFeeMode === "fee_for_service"
                  ? $t("roiNoteFeeForService", { n: facilityRoi })
                  : $t("roiNoteBundled", { n: facilityRoi })}
              </p>
            {:else if audienceMode === "family"}
              <p class="pocket">{$t("pocketNote")}</p>
            {/if}
          </article>
        </div>
        <div class="forecast-head">
          <span class="head-badges">
            <PartnerServiceBadge name="Tavily" source={partnerDock.tavily} />
          </span>
        </div>
        <ImprovementForecast items={forecastItems} />
      {/if}
      <SectionConsoleBox
        title="$ daytona · tavily --cost"
        lanes={["Daytona", "Tavily"]}
        lines={consoleLines}
      />

      <div data-testid="under-the-hood">
        <AgentConsoleLog lines={consoleLines} title={$t("agentConsoleTitle")} />
        {#if audienceMode === "clinician"}
          <p class="clin-only-note">{$t("clinNote")}</p>
          <p class="nosana-note">{$t("nosanaPitch")}</p>
        {/if}
      </div>

      {#if error}<p class="err">{error}</p>{/if}
    </section>
  </div>
  <PartnerStatusDock state={partnerDock} compact={audienceMode === "family"} />
</main>

<DualDocumentModal
  familyConsented={familyConsented}
  {audienceMode}
  open={dualOpen}
  {dual}
  onClose={() => (dualOpen = false)}
  {daytonaSource}
  {codeafSource}
  {nosanaSource}
  {tavilySource}
  evidenceHits={evidence}
/>

<style>
  :global(body) {
    margin: 0;
    font-family: "Inter", "Noto Sans JP", "Hiragino Sans", sans-serif;
    background:
      radial-gradient(ellipse at 10% 0%, #dfeaf7 0%, transparent 50%),
      radial-gradient(ellipse at 90% 10%, #f3e7d3 0%, transparent 45%),
      #f6f3ee;
    color: #172033;
  }
  .cockpit {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1rem 1.1rem 2rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .mode-clinician :global(.family-only) { display: none !important; }
  .mode-family :global(.clinician-only) { display: none !important; }

  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 0.85rem;
    flex-wrap: wrap;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 0.75rem;
  }
  .eyebrow { margin: 0; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: #5b6b82; }
  h1 { margin: 0.15rem 0; font-size: 1.45rem; font-weight: 800; }
  .sub { margin: 0.2rem 0 0; color: #5b6b82; font-size: 0.78rem; }
  .header-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
  .logo-tap { border: none; background: transparent; padding: 0; font: inherit; color: inherit; cursor: pointer; letter-spacing: 0.06em; text-transform: uppercase; }
  .status-bar { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.45rem; align-items: center; }
  .status-bar code { font-size: 0.62rem; background: #0f172a; color: #e2e8f0; padding: 0.2rem 0.45rem; border-radius: 4px; }
  .timer { font-size: 0.72rem; font-weight: 700; color: #0d9488; }
  .ai-btn, .approve-btn, .reject-btn {
    border: none;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    cursor: pointer;
  }
  .ai-btn { background: #0d9488; color: #fff; }
  .approve-btn { background: #1d4ed8; color: #fff; }
  .reject-btn { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .ai-btn:disabled, .approve-btn:disabled, .reject-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .consent-row {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    margin: 0.65rem 0 0.35rem;
    font-size: 0.72rem;
    color: #0f766e;
    font-weight: 600;
  }
  .consent-badge {
    display: inline-block;
    margin: 0 0 0.5rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: #ecfdf5;
    border: 1px solid #6ee7b7;
    color: #047857;
    font-size: 0.65rem;
    font-weight: 700;
  }
  .incentive, .nosana-note, .roi-line {
    margin: 0.35rem 0 0;
    font-size: 0.68rem;
    color: #475569;
  }
  .roi-line { font-weight: 600; color: #0f766e; }
  .fee-toggle {
    margin-top: 0.35rem;
    border: 1px solid #99f6e4;
    background: #f0fdfa;
    color: #0f766e;
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.68rem;
    font-weight: 700;
    cursor: pointer;
  }
  .nosana-note { color: #4338ca; font-weight: 600; }
  .uh-hint { margin: 0.25rem 0 0.35rem; font-size: 0.65rem; color: #64748b; }
    .propose-banner { margin: 0.5rem 0 0; font-size: 0.72rem; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 0.35rem 0.5rem; }
  .approve-banner { margin: 0.5rem 0 0; font-size: 0.72rem; color: #166534; background: #ecfdf5; border: 1px solid #86efac; border-radius: 8px; padding: 0.35rem 0.5rem; }
  .evidence { margin: 0.65rem 0; font-size: 0.72rem; }
  .evidence h4 { margin: 0 0 0.35rem; font-size: 0.75rem; }
  .evidence ul { margin: 0; padding-left: 1rem; }
  .evidence a { color: #1d4ed8; }
  .evidence p { margin: 0.15rem 0 0.4rem; color: #64748b; }

  .cols.viewport-3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    flex: 1;
    align-items: stretch;
  }
  .panel.glass {
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid #e4e0d8;
    border-radius: 16px;
    padding: 0.85rem;
    min-height: 520px;
    display: flex;
    flex-direction: column;
  }
  h2 { margin: 0 0 0.65rem; font-size: 0.82rem; font-weight: 800; letter-spacing: 0.04em; }
  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .head-badges, .card-badges, .form2-head, .forecast-head {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    align-items: center;
  }
  .card-badges {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    z-index: 1;
  }
  .before-after article, .cost-ba article {
    position: relative;
  }
  .scan-strip { margin-bottom: 0.35rem; }
  .resident {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 0.55rem;
    margin-bottom: 0.45rem;
    font-size: 0.75rem;
  }
  .age {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 8px;
    background: #fff;
    border: 1px solid #e2e8f0;
    display: grid;
    place-items: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .egfr {
    margin-left: 0.35rem;
    font-size: 0.62rem;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .symptoms { margin: 0.2rem 0 0; color: #64748b; font-size: 0.68rem; }
  .phi-tag {
    margin-left: auto;
    font-size: 0.62rem;
    color: #0f766e;
    border: 1px solid #99f6e4;
    background: #f0fdfa;
    padding: 0.15rem 0.35rem;
    border-radius: 6px;
    white-space: nowrap;
  }

  .before-after { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; margin-bottom: 0.55rem; }
  .cost-ba {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem;
    margin-bottom: 0.55rem;
  }
  .cost-ba article {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 0.55rem;
    padding: 0.55rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .cost-ba strong { font-size: 1rem; color: #0f172a; }
  .cost-ba .delta { margin: 0.2rem 0 0; font-size: 0.72rem; color: #047857; font-weight: 700; }
  .trace-fold {
    margin-top: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.55rem;
    padding: 0.45rem 0.6rem;
    background: #f8fafc;
  }
  .trace-fold summary {
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
    color: #64748b;
  }
  .before, .after { border-radius: 12px; padding: 0.55rem; font-size: 0.72rem; }
  .before { border: 1px solid #fecdd3; background: #fff1f2; }
  .after { border: 1px solid #99f6e4; background: #f0fdfa; }
  .tag { font-size: 0.62rem; font-weight: 800; letter-spacing: 0.06em; }
  .tag.rose { color: #be123c; }
  .tag.teal { color: #0f766e; }
  h3 { margin: 0.35rem 0; font-size: 0.78rem; }
  .meter { height: 0.45rem; background: #fff; border-radius: 999px; overflow: hidden; border: 1px solid #e2e8f0; }
  .meter span { display: block; height: 100%; border-radius: 999px; }
  .rose-bar span { background: linear-gradient(90deg, #fbbf24, #f43f5e); }
  .teal-bar span { background: linear-gradient(90deg, #2dd4bf, #06b6d4); }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin-top: 0.45rem; }
  .stats div { background: rgba(255,255,255,0.7); border-radius: 8px; padding: 0.35rem; border: 1px solid #e2e8f0; }
  .stats strong { display: block; font-size: 0.85rem; margin-top: 0.15rem; }
  .roi { display: block; font-size: 0.62rem; color: #b45309; margin-top: 0.15rem; }
  .pocket { display: block; font-size: 0.62rem; color: #0f766e; margin-top: 0.15rem; }

  .copy {
    white-space: pre-wrap;
    line-height: 1.55;
    min-height: 3.5rem;
    background: #faf8f4;
    border-radius: 8px;
    padding: 0.65rem;
    font-size: 0.78rem;
    flex: 1;
  }
  .calendar {
    margin: 0.45rem 0;
    padding: 0.55rem;
    border-radius: 10px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    font-size: 0.72rem;
  }
  .calendar h4 { margin: 0 0 0.35rem; }
  .calendar ol { margin: 0; padding-left: 1.1rem; }
  .promise {
    font-size: 0.72rem;
    color: #065f46;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 8px;
    padding: 0.45rem 0.55rem;
  }
  .dual-btn {
    margin-top: 0.55rem;
    align-self: flex-start;
    background: #0d9488;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 0.45rem 0.75rem;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .dual-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .trace { list-style: none; padding: 0; margin: 0; flex: 1; overflow: auto; }
  .trace li {
    display: grid;
    grid-template-columns: 1.5rem 1fr auto;
    gap: 0.35rem;
    align-items: baseline;
    padding: 0.35rem 0;
    border-bottom: 1px solid #eee;
    font-size: 0.78rem;
  }
  .idx { color: #5b6b82; }
  .src { font-size: 0.65rem; background: #e8eef5; padding: 0.1rem 0.35rem; border-radius: 4px; }
  .det { grid-column: 2 / -1; color: #5b6b82; font-size: 0.68rem; }
  .under-hood {
    margin-top: 0.65rem;
    padding: 0.55rem;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 0.68rem;
  }
  .uh-title { margin: 0 0 0.35rem; font-weight: 700; color: #475569; }
  .uh-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.25rem; }
  .uh-grid div { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.25rem; }
  .uh-grid span { display: block; color: #64748b; font-size: 0.6rem; }
  .clin-only-note { margin: 0.45rem 0 0; color: #64748b; font-size: 0.62rem; }
  .err { color: #a11; font-size: 0.75rem; }

  @media (max-width: 1100px) {
    .cols.viewport-3 { grid-template-columns: 1fr; }
    .panel.glass { min-height: auto; }
    .uh-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
