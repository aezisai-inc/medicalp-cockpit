export type AudienceMode = "clinician" | "family";
export type Locale = "ja" | "en";
export type PsychDependency = "NONE" | "HIGH";
export type TraceSource = "fixture" | "live" | "live-cache";

export interface MedicationItem {
  id: string;
  name: string;
  usage: string;
  recommendation: "continue" | "taper" | "stop";
  annualCost: number;
  riskWeight: number;
  dosesPerDay: number;
  active: boolean;
  psychDependency: PsychDependency;
  stepDown: string[];
  /** AI evidence: why stop/taper/continue */
  rationale?: string;
  /** Guideline / literature label */
  guidelineRef?: string;
  /** Expected clinical improvement if deprescribed */
  expectedImprovement?: string;
  /** Prescribing clinic (fixture / pitch: A整形外科, B内科, CメンタルCL). */
  clinic?: string;
}

export interface ResidentCase {
  ageGroup: string;
  egfr: number;
  symptoms: string[];
  careLevel: string;
}

export type TraceLane =
  | "vision"
  | "mask"
  | "tavily"
  | "codeaf"
  | "daytona"
  | "nosana"
  | "orchestrator";

export type TraceLifecycle =
  | "started"
  | "progress"
  | "waiting_heartbeat"
  | "resolved"
  | "purged";

export type FallbackReason =
  | "endpoint_unconfigured"
  | "timeout_ms"
  | "fixture_mode"
  | "http_error"
  | `timeout_${number}ms`;

export interface PhiBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageNatural {
  width: number;
  height: number;
}

export interface AgentTraceEvent {
  step: string;
  at: string;
  source: TraceSource;
  detail?: string;
  /** Wall-clock for this step only (never Promise.all aggregate). */
  durationMs?: number;
  lane?: TraceLane;
  /** In-flight progress lifecycle (G6). */
  lifecycle?: TraceLifecycle;
  /** Elapsed ms while waiting (heartbeat). */
  elapsedMs?: number;
  /** Why SEED/fixture was chosen. */
  fallbackReason?: string;
  egressBytes?: number;
}

export interface AnonymousPayload {
  case: ResidentCase;
  meds: MedicationItem[];
  handwrittenMemo?: string;
}

export interface FamilyViewModel {
  patientBenefitHeadline: string;
  monthlyOutOfPocketCopy: string;
  alertnessCopy: string;
  swallowEaseCopy: string;
  gentleGraduationTitle: string;
  plainEvidence: { title: string; url?: string }[];
}

export interface ClinicalDeprescribeOrder {
  plan: MedicationItem[];
  clinicalEvidence: { title: string; url?: string }[];
  metrics: Record<string, number>;
}

export interface FamilyCareSheet {
  plainSummary: string;
  graduationCalendar: string[];
  reassureBullets: string[];
  outOfPocketNote: string;
}

/** Structured LLM pack attached to audit/run. */
export interface AuditNarrativePack {
  form2SummaryDraft: string;
  improvementForecast: { title: string; detail: string; url?: string }[];
}
