import { Body, Controller, Post } from "@nestjs/common";
import { projectAudienceCopy } from "../domain/audience-copy";
import type { AudienceMode, MedicationItem } from "../domain/types";
import { rewriteFamilyCopy } from "../partners/codeaf";

@Controller("api/copy")
export class CopyController {
  @Post("family")
  async family(
    @Body()
    body: {
      meds?: MedicationItem[];
      clinicianBlob?: string;
      mode?: AudienceMode;
    },
  ) {
    const projected = projectAudienceCopy(
      body.mode ?? "family",
      body.meds ?? [],
      body.clinicianBlob ?? "",
    );
    const rewritten = await rewriteFamilyCopy(projected.displayText);
    return { ...projected, displayText: rewritten.text, source: rewritten.source };
  }
}
