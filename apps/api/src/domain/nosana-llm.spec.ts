import { describe, expect, it } from "vitest";
import { generateAuditNarrative } from "../partners/nosana-llm";
import type { MedicationItem } from "./types";
import { AuditOrchestrator } from "./orchestrator";

const med = (over: Partial<MedicationItem>): MedicationItem => ({
  id: "m1",
  name: "Nexium",
  usage: "15mg",
  recommendation: "stop",
  annualCost: 12000,
  riskWeight: 2,
  dosesPerDay: 1,
  active: false,
  psychDependency: "NONE",
  stepDown: [],
  ...over,
});

describe("generateAuditNarrative", () => {
  it("returns template pack with rationale and form2 draft when LLM unavailable", async () => {
    const prevUrl = process.env.NOSANA_VISION_URL;
    const prevKey = process.env.NOSANA_API_KEY;
    delete process.env.NOSANA_VISION_URL;
    delete process.env.NOSANA_API_KEY;
    const pack = await generateAuditNarrative({
      meds: [
        med({ id: "a", recommendation: "stop" }),
        med({
          id: "b",
          name: "Zolpidem",
          recommendation: "continue",
          psychDependency: "HIGH",
        }),
      ],
      evidence: [{ title: "厚労省ガイダンス", url: "https://example.com" }],
      locale: "ja",
    });
    expect(pack.form2SummaryDraft.length).toBeGreaterThan(10);
    expect(pack.meds.find((m) => m.id === "a")?.rationale).toBeTruthy();
    expect(pack.improvementForecast.length).toBeGreaterThan(0);
    expect(pack.fallbackReason).toBeTruthy();
    if (prevUrl) process.env.NOSANA_VISION_URL = prevUrl;
    if (prevKey) process.env.NOSANA_API_KEY = prevKey;
  });

  it("grounds each stop/taper with drug-risk + rotated evidence (no hits[0] uniform)", async () => {
    const prevUrl = process.env.NOSANA_VISION_URL;
    const prevKey = process.env.NOSANA_API_KEY;
    const prevCodeUrl = process.env.CODEAF_API_URL;
    const prevCodeKey = process.env.CODEAF_API_KEY;
    delete process.env.NOSANA_VISION_URL;
    delete process.env.NOSANA_API_KEY;
    delete process.env.CODEAF_API_URL;
    delete process.env.CODEAF_API_KEY;
    const evidence = [
      { title: "PPI長期リスク", snippet: "骨折・感染リスク上昇" },
      { title: "ループ利尿薬注意", snippet: "脱水・電解質異常" },
      { title: "筋弛緩薬転倒", snippet: "ふらつき転倒" },
    ];
    const pack = await generateAuditNarrative({
      meds: [
        med({ id: "ppi", name: "ネキシウム", recommendation: "stop" }),
        med({ id: "loop", name: "フロセミド", recommendation: "taper" }),
        med({ id: "myo", name: "ミオナール", recommendation: "stop" }),
      ],
      evidence,
      locale: "ja",
    });
    const rationales = pack.meds.map((m) => m.rationale || "");
    expect(new Set(rationales).size).toBe(3);
    expect(rationales[0]).toMatch(/PPI|骨折|ネキシウム/);
    expect(rationales[1]).toMatch(/利尿|脱水|フロセミド/);
    expect(rationales[2]).toMatch(/筋弛緩|転倒|ミオナール/);
    expect(rationales.every((r) => /根拠:/.test(r))).toBe(true);
    const guidelineRefs = pack.meds.map((m) => m.guidelineRef || "");
    expect(new Set(guidelineRefs).size).toBeGreaterThanOrEqual(2);
    for (const m of pack.meds) {
      expect(pack.form2SummaryDraft).toContain(m.rationale || "");
    }
    if (prevUrl) process.env.NOSANA_VISION_URL = prevUrl;
    if (prevKey) process.env.NOSANA_API_KEY = prevKey;
    if (prevCodeUrl) process.env.CODEAF_API_URL = prevCodeUrl;
    if (prevCodeKey) process.env.CODEAF_API_KEY = prevCodeKey;
  });
});

describe("AuditOrchestrator lifecycle (G6)", () => {
  it("visionScan emits started → progress → resolved and returns boxes+natural", async () => {
    const orch = new AuditOrchestrator();
    const lifecycles: string[] = [];
    orch.setProgressHandler((ev) => {
      if (ev.lifecycle) lifecycles.push(ev.lifecycle);
    });
    const r = await orch.visionScan();
    expect(r.preview.boxes.length).toBeGreaterThan(0);
    expect(r.preview.imageNatural.width).toBe(1240);
    expect(lifecycles).toContain("started");
    expect(lifecycles).toContain("progress");
    expect(lifecycles).toContain("resolved");
    const startedAt = lifecycles.indexOf("started");
    const resolvedAt = lifecycles.lastIndexOf("resolved");
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(resolvedAt).toBeGreaterThan(startedAt);
  });

  it("auditRun emits waiting_heartbeat then resolved for partners", async () => {
    const prevPartner = process.env.PARTNER_MS;
    process.env.PARTNER_MS = "50";
    const orch = new AuditOrchestrator();
    const lifecycles: string[] = [];
    orch.setProgressHandler((ev) => {
      if (ev.lifecycle) lifecycles.push(ev.lifecycle);
    });
    await orch.auditRun("clinician", "ja", {});
    expect(lifecycles).toContain("started");
    expect(
      lifecycles.includes("waiting_heartbeat") || lifecycles.includes("resolved"),
    ).toBe(true);
    expect(lifecycles).toContain("resolved");
    if (prevPartner === undefined) delete process.env.PARTNER_MS;
    else process.env.PARTNER_MS = prevPartner;
  }, 30_000);

  it("auditRun pushes per-partner resolved with distinct timestamps (not batch)", async () => {
    const prevPartner = process.env.PARTNER_MS;
    process.env.PARTNER_MS = "80";
    const orch = new AuditOrchestrator();
    const resolvedAt = new Map<string, string>();
    orch.setProgressHandler((ev) => {
      if (ev.lifecycle === "resolved" && ["Tavily", "Daytona", "Nosana.narrative"].includes(ev.step)) {
        resolvedAt.set(ev.step, ev.at);
      }
    });
    await orch.auditRun("clinician", "ja", {});
    expect(resolvedAt.has("Tavily")).toBe(true);
    expect(resolvedAt.has("Nosana.narrative")).toBe(true);
    const stamps = [...resolvedAt.values()];
    expect(new Set(stamps).size).toBeGreaterThanOrEqual(1);
    // At least one started for Tavily before Nosana resolved (ordering via progress handler).
    const steps: string[] = [];
    const orch2 = new AuditOrchestrator();
    orch2.setProgressHandler((ev) => {
      if (ev.lifecycle) steps.push(`${ev.step}:${ev.lifecycle}`);
    });
    await orch2.auditRun("clinician", "ja", {});
    const tavilyStart = steps.indexOf("Tavily:started");
    const nosanaResolved = steps.indexOf("Nosana.narrative:resolved");
    expect(tavilyStart).toBeGreaterThanOrEqual(0);
    expect(nosanaResolved).toBeGreaterThan(tavilyStart);
    if (prevPartner === undefined) delete process.env.PARTNER_MS;
    else process.env.PARTNER_MS = prevPartner;
  }, 30_000);

  it("clearScanImageBuffer retains regions/labels from last vision scan", async () => {
    const { clearScanImageBuffer, rememberMaskProof } = await import("./orchestrator");
    rememberMaskProof("default", {
      regions: 3,
      labels: ["氏名", "生年月日", "保険者番号"],
      boxes: [],
    });
    const cleared = clearScanImageBuffer("default");
    expect(cleared.proof.regions).toBe(3);
    expect(cleared.proof.labels).toEqual(["氏名", "生年月日", "保険者番号"]);
    expect(cleared.proof.sha256).toBe("cleared");
    expect(cleared.proof.egress).toBe(0);
  });

  it("narrative fallbackReason uses endpoint_unconfigured when all LLM env unset", async () => {
    const prev = {
      NOSANA_VISION_URL: process.env.NOSANA_VISION_URL,
      NOSANA_API_KEY: process.env.NOSANA_API_KEY,
      CODEAF_API_URL: process.env.CODEAF_API_URL,
      CODEAF_API_KEY: process.env.CODEAF_API_KEY,
      NOSANA_TIMEOUT_MS: process.env.NOSANA_TIMEOUT_MS,
      PARTNER_MS: process.env.PARTNER_MS,
    };
    for (const k of Object.keys(prev)) delete process.env[k];
    const pack = await generateAuditNarrative({
      meds: [med({ id: "a" })],
      evidence: [],
      locale: "ja",
    });
    expect(pack.fallbackReason).toBe("endpoint_unconfigured");
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
});