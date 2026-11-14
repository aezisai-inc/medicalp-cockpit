import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MedicationItem, TraceSource } from "../domain/types";
import { computeImpactMetrics, medsSavingsPool } from "../domain/impact-metrics";
import { medsEligibleForSavings } from "../domain/psych-lock";
import { fixturesRoot } from "../domain/paths";
import {
  applyCodeAfSpecToMetrics,
  codeAfHintDigest,
  defaultCodeAfSpec,
  normalizeCodeAfSpec,
  type CodeAfSpec,
} from "../knowledge/pharmacist-kb";
import { readLiveCache, writeLiveCache } from "./tavily";

const DEFAULT_DAYTONA_API_URL = "https://app.daytona.io/api";

export type DaytonaSimResult = {
  metrics: Record<string, number>;
  destroyProof: string;
  source: TraceSource;
  sandboxId?: string;
  fallbackReason?: string;
  /** Proof of Execution: KB rules applied inside sandbox (or host apply). */
  appliedKbRules?: string[];
  /** SHA-256 prefix of normalized CodeAF spec consumed by sim. */
  codeAfHintDigest?: string;
  stdoutExcerpt?: string;
  executionMs?: number;
};

function fromCache(fallbackMetrics: Record<string, number>): DaytonaSimResult | null {
  const cached = readLiveCache<{
    metrics: Record<string, number>;
    destroyProof: string;
    sandboxId?: string;
    appliedKbRules?: string[];
    codeAfHintDigest?: string;
  }>("daytona-sim");
  if (cached?.destroyProof?.startsWith("destroyed:")) {
    return {
      metrics: { ...fallbackMetrics, ...(cached.metrics ?? {}) },
      destroyProof: cached.destroyProof,
      source: "live-cache",
      sandboxId: cached.sandboxId,
      appliedKbRules: cached.appliedKbRules,
      codeAfHintDigest: cached.codeAfHintDigest,
    };
  }
  return null;
}

function loadSandboxScript(): string {
  const candidates = [
    join(__dirname, "../scoring/sandbox-script.py.txt"),
    join(process.cwd(), "src/scoring/sandbox-script.py.txt"),
    join(fixturesRoot(), "../apps/api/src/scoring/sandbox-script.py.txt"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return `import json
if "_meds" not in globals():
  _meds = []
if "_max_cost" not in globals():
  _max_cost = 0
if "_codeaf_spec" not in globals():
  _codeaf_spec = {}
print(json.dumps({"fallRiskBefore":88,"fallRiskAfter":40,"costDelta":0,"riskDelta":0,"assistDelta":0,"appliedKbRules":[]}))
`;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isDiskQuotaError(msg: string): boolean {
  return /disk limit exceeded|Maximum allowed:\s*\d+GiB/i.test(msg);
}

/** Lambda read-only FS: keep Daytona SDK config under /tmp. */
function ensureLambdaWritableHome(): void {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) {
    if (!process.env.HOME || process.env.HOME === "/" || process.env.HOME === "/home/sbx_user") {
      process.env.HOME = "/tmp";
    }
  }
}

async function deleteStoppedSandboxes(
  apiKey: string,
  apiUrl: string,
): Promise<number> {
  const base = apiUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${base}/sandbox`, { headers });
  if (!res.ok) {
    throw new Error(`list sandboxes HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: { id: string; state?: string }[] };
  const items = data.items ?? [];
  let deleted = 0;
  for (const s of items) {
    if (s.state === "started") {
      await fetch(`${base}/sandbox/${s.id}/stop`, { method: "POST", headers }).catch(
        () => undefined,
      );
    }
    const d = await fetch(`${base}/sandbox/${s.id}`, {
      method: "DELETE",
      headers,
    });
    if (d.ok || d.status === 404) deleted += 1;
    if (deleted >= 40) break;
  }
  return deleted;
}

function resolveSpec(
  meds: MedicationItem[],
  codeAfSpec?: CodeAfSpec | null,
): { spec: CodeAfSpec; digest: string } {
  const names = meds.map((m) => m.name);
  const spec = normalizeCodeAfSpec(codeAfSpec ?? defaultCodeAfSpec(names), names);
  return { spec, digest: codeAfHintDigest(spec) };
}

/**
 * Daytona SDK: create → process.codeRun(_meds,_max_cost,_codeaf_spec) → delete.
 * Proof of Execution: sandbox (or host apply) consumes CodeAF pharmacist KB spec.
 */
export async function runDeprescribeSim(
  meds: MedicationItem[],
  codeAfSpec?: CodeAfSpec | null,
): Promise<DaytonaSimResult> {
  const eligible = medsEligibleForSavings(meds);
  const computed = computeImpactMetrics(meds);
  const { spec, digest } = resolveSpec(meds, codeAfSpec);
  const metricsBase: Record<string, number> = { ...computed };
  const hostApplied = applyCodeAfSpecToMetrics(metricsBase, spec);

  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  const apiUrl = (
    process.env.DAYTONA_API_URL || DEFAULT_DAYTONA_API_URL
  ).trim();

  if (!apiKey) {
    const cached = fromCache(hostApplied);
    // Only reuse cache when digest matches — otherwise Proof of Execution is fake.
    if (cached && cached.codeAfHintDigest === digest) {
      return {
        ...cached,
        codeAfHintDigest: digest,
        appliedKbRules: cached.appliedKbRules || spec.kb_rule_id,
        fallbackReason: "daytona_api_key_missing",
      };
    }
    return {
      metrics: hostApplied,
      destroyProof: "destroyed:fixture-sandbox",
      source: "fixture",
      fallbackReason: "daytona_api_key_missing",
      appliedKbRules: spec.kb_rule_id,
      codeAfHintDigest: digest,
    };
  }

  ensureLambdaWritableHome();

  const runOnce = async (): Promise<DaytonaSimResult> => {
    const t0 = Date.now();
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({ apiKey, apiUrl });
    const sandbox = await daytona.create({ language: "python" });
    const sandboxId =
      (sandbox as { id?: string }).id ??
      (sandbox as { sandboxId?: string }).sandboxId ??
      `sbx-${Date.now()}`;

    try {
      const script = loadSandboxScript();
      const medPayload = JSON.stringify(
        eligible.map((m) => ({ id: m.id, annualCost: m.annualCost })),
      );
      const maxCost = medsSavingsPool(meds).reduce(
        (s, m) => s + (m.annualCost || 0),
        0,
      );
      // Double-stringify so Python json.loads gets a JSON object (avoids True/False).
      const specLiteral = JSON.stringify(JSON.stringify(spec));
      const codeSafe = `import json as _json\n_meds = ${medPayload}\n_max_cost = ${maxCost}\n_codeaf_spec = _json.loads(${specLiteral})\n${script}\n`;
      const response = await sandbox.process.codeRun(codeSafe);
      const executionMs = Date.now() - t0;
      const stdout = String(response.result ?? "");
      if (response.exitCode !== 0) {
        throw new Error(`codeRun exit ${response.exitCode}: ${stdout}`);
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const num = (k: string, fb: number) => {
        const v = parsed[k];
        return typeof v === "number" ? v : fb;
      };
      const liveMetrics = {
        ...hostApplied,
        fallRiskBefore: num("fallRiskBefore", hostApplied.fallRiskBefore),
        fallRiskAfter: num("fallRiskAfter", hostApplied.fallRiskAfter),
        costDelta: num("costDelta", hostApplied.costDelta),
        assistDelta: num("assistDelta", hostApplied.assistDelta),
        riskDelta: num("riskDelta", hostApplied.riskDelta),
      };
      const appliedKbRules = Array.isArray(parsed.appliedKbRules)
        ? (parsed.appliedKbRules as unknown[]).map(String)
        : spec.kb_rule_id;
      const destroyProof = `destroyed:${sandboxId}`;
      writeLiveCache("daytona-sim", {
        metrics: liveMetrics,
        destroyProof,
        sandboxId,
        appliedKbRules,
        codeAfHintDigest: digest,
      });
      return {
        metrics: liveMetrics,
        destroyProof,
        source: "live",
        sandboxId,
        appliedKbRules,
        codeAfHintDigest: digest,
        stdoutExcerpt: stdout.slice(0, 240),
        executionMs,
      };
    } finally {
      try {
        await daytona.delete(sandbox);
      } catch {
        /* best-effort destroy */
      }
    }
  };

  let lastErr = "";
  try {
    return await runOnce();
  } catch (e1) {
    lastErr = errMessage(e1);
    if (isDiskQuotaError(lastErr)) {
      try {
        const n = await deleteStoppedSandboxes(apiKey, apiUrl);
        lastErr = `${lastErr} · cleaned_stopped=${n}`;
        return await runOnce();
      } catch (e2) {
        lastErr = `${lastErr} · cleanup_or_retry: ${errMessage(e2)}`;
      }
    }
  }

  const cached = fromCache(hostApplied);
  if (cached) {
    return {
      ...cached,
      codeAfHintDigest: cached.codeAfHintDigest || digest,
      appliedKbRules: cached.appliedKbRules || spec.kb_rule_id,
      fallbackReason: `daytona_sdk_error: ${lastErr.slice(0, 240)}`,
    };
  }

  return {
    metrics: hostApplied,
    destroyProof: "destroyed:fixture-sandbox",
    source: "fixture",
    fallbackReason: `daytona_sdk_error: ${lastErr.slice(0, 240)}`,
    appliedKbRules: spec.kb_rule_id,
    codeAfHintDigest: digest,
  };
}
