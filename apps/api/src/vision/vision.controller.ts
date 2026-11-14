import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import {
  AuditOrchestrator,
  clearScanImageBuffer,
  VisionOcrRequiredError,
} from "../domain/orchestrator";

type ScanBody = {
  imageBase64?: string;
  mimeType?: string;
  /** Optional raw multipart field echoed as base64 by some clients */
  image?: string;
};

function decodeBase64Image(body?: ScanBody): {
  bytes: Buffer;
  mimeType: string;
} | undefined {
  const raw = (body?.imageBase64 || body?.image)?.trim();
  if (!raw) return undefined;
  const dataUrl = raw.match(/^data:([^;]+);base64,(.+)$/i);
  const mimeType = body?.mimeType || dataUrl?.[1] || "image/jpeg";
  const b64 = dataUrl?.[2] ?? raw;
  try {
    const bytes = Buffer.from(b64, "base64");
    if (!bytes.length) return undefined;
    return { bytes, mimeType };
  } catch {
    return undefined;
  }
}

@Controller("api/vision")
export class VisionController {
  /**
   * Primary path: JSON `{ imageBase64, mimeType }` (canvas-resized JPEG).
   * Avoids CloudFront/LWA multipart binary corruption; FE always sends this.
   */
  @Post("scan")
  async scan(@Body() body?: ScanBody) {
    const image = decodeBase64Image(body);
    const orch = new AuditOrchestrator();
    try {
      return await orch.visionScan(image);
    } catch (e) {
      if (e instanceof VisionOcrRequiredError) {
        throw new HttpException(
          { message: e.message, code: "VISION_OCR_REQUIRED" },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw e;
    }
  }

  /** Clear Image: zero ephemeral scan buffer; retain last regions/labels on proof strip. */
  @Post("clear")
  clear(@Query("sessionId") sessionId?: string) {
    const result = clearScanImageBuffer(sessionId || "default");
    return {
      cleared: result.cleared,
      preview: {
        masked: false,
        regions: result.proof.regions,
        boxes: [],
        imageNatural: { width: 0, height: 0 },
      },
      proof: result.proof,
      trace: [
        {
          step: "Mask.purge",
          at: new Date().toISOString(),
          source: "live" as const,
          detail: `pixels discarded · proof strip retained · regions=${result.proof.regions} · labels=${result.proof.labels.join(",") || "none"}`,
          lane: "mask" as const,
          lifecycle: "purged" as const,
          egressBytes: 0,
        },
      ],
    };
  }
}
