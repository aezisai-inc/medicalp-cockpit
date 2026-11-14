const PHI_KEYS = new Set([
  "patientName",
  "patient_name",
  "fullName",
  "hospitalName",
  "hospital_name",
  "facilityName",
]);

const PHI_VALUE_RE =
  /(患者|様|[一-龥]{2,4}(太郎|花子)|さくら病院|[一-龥]+(医院|病院|クリニック))/u;

export function stripPhiDeep<T>(input: T): T {
  return walk(input) as T;
}

function walk(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (PHI_KEYS.has(k) && typeof val === "string") {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = walk(val);
    }
    return out;
  }
  if (typeof v === "string" && PHI_VALUE_RE.test(v)) {
    return v.replace(PHI_VALUE_RE, "[REDACTED]");
  }
  return v;
}

export function assertNoPhiStrings(payload: unknown, forbidden: string[]): void {
  const blob = JSON.stringify(payload);
  for (const f of forbidden) {
    if (f && blob.includes(f)) {
      throw new Error(`PHI egress blocked: found "${f}"`);
    }
  }
}
