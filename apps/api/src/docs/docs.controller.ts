import { Body, Controller, Post } from "@nestjs/common";
import { AuditOrchestrator } from "../domain/orchestrator";
import type { Locale, MedicationItem } from "../domain/types";

function normalizeLocale(v?: string): Locale {
  return v === "en" ? "en" : "ja";
}

@Controller("api/docs")
export class DocsController {
  @Post("dual")
  async dual(
    @Body()
    body: {
      meds?: MedicationItem[];
      metrics?: Record<string, number>;
      locale?: string;
    },
  ) {
    const orch = new AuditOrchestrator();
    return orch.dualDocs(
      body.meds ?? [],
      body.metrics ?? {},
      normalizeLocale(body?.locale),
    );
  }
}
