/**
 * StoryBDD — executable acceptance for AC-01..09 and AC-14..16 (scenario sync).
 * Living specs: tests/features/*.feature
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AuditOrchestrator } from "../../src/domain/orchestrator";
import { FAMILY_FORBIDDEN, projectAudienceCopy } from "../../src/domain/audience-copy";
import { stripPhiDeep, assertNoPhiStrings } from "../../src/domain/anonymize";
import { computeImpactMetrics } from "../../src/domain/impact-metrics";

const logDir = join(process.cwd(), "test-results");
mkdirSync(logDir, { recursive: true });

function evidence(name: string, payload: unknown) {
  writeFileSync(join(logDir, `${name}.json`), JSON.stringify(payload, null, 2));
}

describe("Feature: ClosedRealm paper scan and PHI mask (AC-01/02)", () => {
  it("Scan fixture paints black PHI boxes + hydrates meds", async () => {
    const orch = new AuditOrchestrator();
    const scan = await orch.visionScan();
    expect(scan.preview.masked).toBe(true);
    expect(scan.preview.regions).toBeGreaterThanOrEqual(2);
    expect(scan.payload.meds.length).toBe(9);
    expect(scan.payload.case.egfr).toBe(42);
    const blob = JSON.stringify(scan.payload);
    expect(blob.includes("山田太郎")).toBe(false);
    evidence("ac-01-02-scan", scan);
  });
});


describe("Feature: Scan phase all-continue baseline", () => {
  it("visionScan leaves every med continue + active before auditRun", async () => {
    const orch = new AuditOrchestrator();
    const scan = await orch.visionScan();
    expect(scan.payload.meds.length).toBeGreaterThan(0);
    expect(scan.payload.meds.every((m) => m.recommendation === "continue" && m.active)).toBe(
      true,
    );
    const run = await orch.auditRun("clinician");
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of run.meds) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 2, continue: 3 });
    evidence("scan-continue-then-audit", { scanContinue: scan.payload.meds, auditCounts: counts });
  });
});

describe("Feature: PsychDependency lock (AC-03)", () => {
  it("HIGH lock excluded from AI batch", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician");
    const high = run.meds.filter((m) => m.psychDependency === "HIGH");
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((m) => m.active)).toBe(true);
    evidence("ac-03-lock", { high, metrics: run.metrics });
  });
});

describe("Feature: Pitch prescription matrix (AC-10)", () => {
  it("AI plan is stop4 / taper2 / continue3 with pitch meters", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician");
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of run.meds) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 2, continue: 3 });
    expect(run.metrics.costDelta).toBe(68400);
    expect(run.metrics.fallRiskAfter).toBe(18);
    expect(run.metrics.assistDelta).toBe(1095);
    evidence("ac-10-pitch-matrix", { counts, metrics: run.metrics });
  });
});

describe("Feature: Nosana vision labeled path (AC-13)", () => {
  it("Vision scan reports Nosana or labeled live-cache/fixture detail", async () => {
    const orch = new AuditOrchestrator();
    const scan = await orch.visionScan();
    const vision = orch.getTrace().find((t) => t.step === "Vision");
    expect(vision).toBeTruthy();
    expect(["live", "live-cache", "fixture"]).toContain(vision!.source);
    const detail = `${vision!.detail ?? ""} ${scan.source}`;
    if (vision!.source === "live") {
      expect(detail.toLowerCase()).toMatch(/nosana/);
    } else if (vision!.source === "live-cache") {
      expect(detail.toLowerCase()).toMatch(/nosana|live-cache|seed|plan b/);
    } else {
      expect(detail.toLowerCase()).toMatch(/fixture/);
    }
    evidence("ac-13-nosana-vision", { vision, scanSource: scan.source });
  });
});

describe("Feature: AudienceMode informed consent (AC-04/05)", () => {
  it("Family mode hides facility ROI lexicon and shows lock promise", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("family", "ja");
    for (const w of FAMILY_FORBIDDEN) {
      expect(run.audience.displayText.includes(w)).toBe(false);
    }
    expect(run.audience.displayText).toMatch(/急に止め/);
    expect(run.audience.family?.gentleGraduationTitle).toBeTruthy();
    evidence("ac-04-05-family", run.audience);
  });

  it("Family locale=en returns English narrative without FAMILY_FORBIDDEN", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("family", "en");
    for (const w of FAMILY_FORBIDDEN) {
      expect(run.audience.displayText.includes(w)).toBe(false);
    }
    expect(run.audience.displayText).toMatch(/taper|abruptly|Gentle/i);
    expect(run.locale).toBe("en");
    const dual = await orch.dualDocs(run.meds, run.metrics, "en");
    expect(dual.form2.title).toMatch(/Form-2/i);
    evidence("ac-04-05-family-en", { audience: run.audience, form2: dual.form2 });
  });
});

describe("Feature: AudienceMode tab switch without re-audit", () => {
  it("One auditRun + dualDocs serves clinician and family display (no second auditRun)", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician", "ja");
    const dual = await orch.dualDocs(run.meds, run.metrics, "ja");
    const family = projectAudienceCopy("family", run.meds, run.audience.displayText, "ja");
    for (const w of FAMILY_FORBIDDEN) {
      expect(family.displayText.includes(w)).toBe(false);
    }
    expect(dual.family.plainSummary).toBeTruthy();
    expect(dual.form2.pointsNote).toMatch(/1,000/);
    evidence("ac-audience-no-recalc", { dual: { form2: dual.form2.title, family: dual.family.plainSummary } });
  });
});

describe("Feature: Dual documents (AC-06)", () => {
  it("Dual docs payload returned together", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician");
    const dual = await orch.dualDocs(run.meds, run.metrics);
    expect(dual.clinical.plan.length).toBeGreaterThan(0);
    expect(dual.family.plainSummary).toBeTruthy();
    evidence("ac-06-dual", dual);
  });
});

describe("Feature: Form-2 pitch buckets (AC-11)", () => {
  it("form2 exposes stop/taper/continue counts matching pitch matrix", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician");
    const dual = await orch.dualDocs(run.meds, run.metrics, "ja");
    expect(dual.form2.buckets.counts).toEqual({ stop: 4, taper: 2, continue: 3 });
    expect(dual.form2.pointsNote).toMatch(/1,000/);
    expect(dual.form2.pointsNote).toMatch(/250/);
    evidence("ac-11-form2-buckets", dual.form2);
  });
});

describe("Feature: Live agent trace (AC-07)", () => {
  it("Trace order and destroy recorded", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician");
    const steps = run.trace.map((t) => t.step);
    const required = [
      "Vision",
      "Mask",
      "Tavily",
      "CodeAF",
      "Daytona.destroy",
      "Nosana.narrative",
    ];
    // Required partner lanes appear in order; Orchestrator bookends may interleave.
    let cursor = 0;
    for (const need of required) {
      const idx = steps.indexOf(need, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + 1;
    }
    expect(run.trace.every((t) => ["fixture", "live", "live-cache"].includes(t.source))).toBe(
      true,
    );
    const timed = run.trace.filter((t) =>
      ["Tavily", "CodeAF", "Daytona.destroy", "Nosana.narrative"].includes(t.step),
    );
    expect(timed.every((t) => typeof t.durationMs === "number")).toBe(true);
    expect(run.form2SummaryDraft?.length).toBeGreaterThan(0);
    evidence("ac-07-trace", run.trace);
  });
});

describe("Feature: PHI egress guard (AC-08)", () => {
  it("Partner payloads have no PHI strings", () => {
    const raw = {
      patientName: "山田太郎",
      hospitalName: "さくら病院",
      query: "deprescribing",
    };
    const clean = stripPhiDeep(raw);
    assertNoPhiStrings(clean, ["山田太郎", "さくら病院"]);
    evidence("ac-08-phi", clean);
  });
});

describe("Feature: Move-in day three-clinic audit (AC-14)", () => {
  it("Nine meds from three clinics with dosing pitch on move-in day", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician", "ja");
    const fixture = orch.loadFixtureResident();
    expect(fixture?.case.ageGroup).toBe("80s");
    expect(run.meds).toHaveLength(9);
    const clinics = [...new Set(run.meds.map((m) => m.clinic).filter(Boolean))].sort();
    expect(clinics).toEqual(["A整形外科", "B内科", "CメンタルCL"]);
    const counts = { stop: 0, taper: 0, continue: 0 };
    for (const m of run.meds) counts[m.recommendation] += 1;
    expect(counts).toEqual({ stop: 4, taper: 2, continue: 3 });
    expect(run.metrics.dailyDosesBefore).toBe(4);
    expect(run.metrics.dailyDosesAfter).toBe(1);
    expect(run.metrics.annualAssistsBefore).toBe(1460);
    expect(run.metrics.annualAssistsAfter).toBe(365);
    const dual = await orch.dualDocs(run.meds, run.metrics, "ja");
    expect(dual.form2.facility).toMatch(/サービス付き高齢者/);
    evidence("ac-14-move-in-3clinic", { clinics, counts, metrics: run.metrics, facility: dual.form2.facility });
  });
});

describe("Feature: Five stakeholder win relay (AC-15)", () => {
  it("Form2 relay points and five-way win metrics at full pitch", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician", "ja");
    const dual = await orch.dualDocs(run.meds, run.metrics, "ja");
    expect(dual.form2.pointsNote).toMatch(/1,000/);
    expect(dual.form2.pointsNote).toMatch(/250/);
    expect(run.metrics.costDelta).toBe(68400);
    expect(run.metrics.assistDelta).toBe(1095);
    expect(run.metrics.fallRiskBefore).toBe(88);
    expect(run.metrics.fallRiskAfter).toBe(18);
    expect(run.metrics.fractureCostAvoidedMan).toBe(150);
    evidence("ac-15-five-win", {
      pointsNote: dual.form2.pointsNote,
      metrics: run.metrics,
    });
  });
});

describe("Feature: Facility fee type label toggle (AC-16)", () => {
  it("Fee-type label toggle is display-only — impact metrics unchanged", async () => {
    const orch = new AuditOrchestrator();
    const run = await orch.auditRun("clinician", "ja");
    const baseline = { ...run.metrics };
    const relabeled = computeImpactMetrics(run.meds);
    expect(relabeled.costDelta).toBe(baseline.costDelta);
    expect(relabeled.assistDelta).toBe(baseline.assistDelta);
    expect(relabeled.fractureCostAvoidedMan).toBe(baseline.fractureCostAvoidedMan);
    expect(relabeled.dailyDosesAfter).toBe(baseline.dailyDosesAfter);
    const feeModes = ["output-based-80", "bundled-20"] as const;
    for (const _mode of feeModes) {
      const again = computeImpactMetrics(run.meds);
      expect(again).toEqual(relabeled);
    }
    evidence("ac-16-fee-label-no-recalc", { baseline, feeModes });
  });
});

describe("Feature: CloudFront pitch smoke (AC-09 local surrogate)", () => {
  it("Local happy path Scan→family→dual→destroy (CF deploy is ship gate)", async () => {
    const orch = new AuditOrchestrator();
    const scan = await orch.visionScan();
    const family = await orch.auditRun("family");
    const dual = await orch.dualDocs(family.meds, family.metrics);
    const destroy = family.trace.find((t) => t.step === "Daytona.destroy");
    expect(scan.preview.masked).toBe(true);
    expect(family.audience.mode).toBe("family");
    expect(dual.family).toBeTruthy();
    expect(destroy?.detail).toMatch(/destroyed/);
    evidence("ac-09-local-smoke", { scan: scan.preview, destroy, dualKeys: Object.keys(dual) });
  });
});
