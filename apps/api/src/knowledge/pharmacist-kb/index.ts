import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type CodeAfSpec = {
  taper_step_ratio: number;
  half_life_hours: number;
  acb_weights: Record<string, number>;
  kb_rule_id: string[];
  searchQuery?: string;
  focusMedIds?: string[];
  rationale?: string;
};

type KbAudit = {
  id: string;
  rules: { id: string; summary: string; match: string[] }[];
};

type KbPk = {
  id: string;
  defaults: {
    taper_step_ratio: number;
    half_life_hours: number;
    acb_weights: Record<string, number>;
  };
};

function kbDir(): string {
  const candidates = [
    join(__dirname),
    join(process.cwd(), "src/knowledge/pharmacist-kb"),
    join(process.cwd(), "apps/api/src/knowledge/pharmacist-kb"),
  ];
  for (const d of candidates) {
    if (existsSync(join(d, "kb-pk-daytona-templates.json"))) return d;
  }
  return __dirname;
}

function readJson<T>(name: string, fallback: T): T {
  const p = join(kbDir(), name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function readMd(name: string): string {
  const p = join(kbDir(), name);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

const FALLBACK_PK: KbPk = {
  id: "KB-2",
  defaults: {
    taper_step_ratio: 0.75,
    half_life_hours: 30,
    acb_weights: { olanzapine: 3 },
  },
};

const FALLBACK_AUDIT: KbAudit = {
  id: "KB-1",
  rules: [
    {
      id: "BEERS-2023-ACB",
      summary: "ACB burden",
      match: ["olanzapine"],
    },
  ],
};

export function loadPharmacistKb(): {
  audit: KbAudit;
  pk: KbPk;
  familyMd: string;
} {
  return {
    audit: readJson("kb-audit-interactions.json", FALLBACK_AUDIT),
    pk: readJson("kb-pk-daytona-templates.json", FALLBACK_PK),
    familyMd: readMd("kb-family-counseling.md"),
  };
}

/** Compact system context for CodeAF chat/completions. */
export function pharmacistKbSystemContext(): string {
  const { audit, pk, familyMd } = loadPharmacistKb();
  const rules = audit.rules
    .map((r) => `${r.id}: ${r.summary}`)
    .join(" | ");
  return [
    "You are CodeAF Pharmacist Knowledge Harness for Care-Audit.",
    `KB-1 rules: ${rules}`,
    `KB-2 defaults: taper_step_ratio=${pk.defaults.taper_step_ratio}, half_life_hours=${pk.defaults.half_life_hours}`,
    `KB-3 family ethics:\n${familyMd.slice(0, 600)}`,
    "Reply JSON only for sandbox-hint mode: {taper_step_ratio,half_life_hours,acb_weights,kb_rule_id,searchQuery,focusMedIds,rationale,scriptHint}.",
    "Never invent PHI (names, hospitals).",
  ].join("\n");
}

export function defaultCodeAfSpec(medNames: string[] = []): CodeAfSpec {
  const { audit, pk } = loadPharmacistKb();
  const lower = medNames.map((n) => n.toLowerCase());
  const matched = audit.rules.filter((r) =>
    r.match.some((m) => lower.some((n) => n.includes(m.toLowerCase()))),
  );
  const kb_rule_id =
    matched.length > 0
      ? matched.map((r) => r.id)
      : ["BEERS-2023-ACB", "STOPP-FALL-RISK"];
  return {
    taper_step_ratio: pk.defaults.taper_step_ratio,
    half_life_hours: pk.defaults.half_life_hours,
    acb_weights: { ...pk.defaults.acb_weights },
    kb_rule_id,
    searchQuery:
      "deprescribing elderly PPI benzodiazepine Beers STOPP 高齢者 医薬品適正使用",
    focusMedIds: [],
    rationale: matched.map((r) => r.summary).join("; ") || "default KB plan",
  };
}

export function normalizeCodeAfSpec(
  raw: unknown,
  medNames: string[] = [],
): CodeAfSpec {
  const base = defaultCodeAfSpec(medNames);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const taper = Number(o.taper_step_ratio);
  const half = Number(o.half_life_hours);
  const rules = Array.isArray(o.kb_rule_id)
    ? o.kb_rule_id.filter((x): x is string => typeof x === "string")
    : base.kb_rule_id;
  const acb =
    o.acb_weights && typeof o.acb_weights === "object"
      ? (o.acb_weights as Record<string, number>)
      : base.acb_weights;
  return {
    taper_step_ratio:
      Number.isFinite(taper) && taper > 0 && taper <= 1.5 ? taper : base.taper_step_ratio,
    half_life_hours:
      Number.isFinite(half) && half > 0 ? half : base.half_life_hours,
    acb_weights: acb,
    kb_rule_id: rules.length ? rules : base.kb_rule_id,
    searchQuery:
      typeof o.searchQuery === "string" && o.searchQuery.trim()
        ? o.searchQuery.trim()
        : base.searchQuery,
    focusMedIds: Array.isArray(o.focusMedIds)
      ? o.focusMedIds.filter((x): x is string => typeof x === "string")
      : [],
    rationale:
      typeof o.rationale === "string" ? o.rationale : base.rationale,
  };
}

/** Extract first JSON object from model text (fence-tolerant). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function codeAfHintDigest(spec: CodeAfSpec): string {
  const canonical = JSON.stringify({
    taper_step_ratio: spec.taper_step_ratio,
    half_life_hours: spec.half_life_hours,
    acb_weights: spec.acb_weights,
    kb_rule_id: [...spec.kb_rule_id].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/** Host-side apply so fixture/live-cache stay consistent with sandbox math. */
export function applyCodeAfSpecToMetrics(
  base: Record<string, number>,
  spec: CodeAfSpec,
): Record<string, number> {
  const taper = spec.taper_step_ratio;
  const halfFactor = Math.min(1.25, Math.max(0.75, spec.half_life_hours / 30));
  const acbSum = Object.values(spec.acb_weights).reduce((a, b) => a + Number(b || 0), 0);
  const acbBoost = Math.min(0.2, acbSum * 0.02);
  const before = Number(base.fallRiskBefore ?? 88);
  const rawAfter = Number(base.fallRiskAfter ?? 40);
  const drop = Math.max(0, before - rawAfter) * taper * (1 + acbBoost);
  const fallRiskAfter = Math.max(18, Math.min(before, Math.round(before - drop)));
  return {
    ...base,
    fallRiskBefore: before,
    fallRiskAfter,
    costDelta: Math.round(Number(base.costDelta ?? 0) * taper),
    riskDelta: Math.round(Number(base.riskDelta ?? 0) * taper * (1 + acbBoost)),
    assistDelta: Math.round(Number(base.assistDelta ?? 0) * taper * halfFactor),
  };
}
