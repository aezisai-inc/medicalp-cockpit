import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  AuditOrchestrator,
  PartnerNotLiveError,
  VisionOcrRequiredError,
} from "../domain/orchestrator";
import type {
  AgentTraceEvent,
  AudienceMode,
  Locale,
  MedicationItem,
  ResidentCase,
  TraceSource,
} from "../domain/types";

function normalizeLocale(v?: string): Locale {
  return v === "en" ? "en" : "ja";
}

function parseStrict(
  bodyStrict?: boolean,
  queryStrict?: string,
  headerStrict?: string,
): boolean {
  return (
    bodyStrict === true ||
    queryStrict === "1" ||
    queryStrict === "true" ||
    headerStrict === "1" ||
    headerStrict === "true"
  );
}

type AuditBody = {
  audienceMode?: AudienceMode;
  locale?: string;
  strict?: boolean;
  meds?: MedicationItem[];
  case?: ResidentCase;
  caseSummary?: ResidentCase;
  visionSource?: TraceSource;
  stream?: boolean;
};

function wantsStream(
  body: AuditBody | undefined,
  queryStream?: string,
  accept?: string,
): boolean {
  if (body?.stream === true) return true;
  if (queryStream === "1" || queryStream === "true") return true;
  return (accept || "").toLowerCase().includes("text/event-stream");
}

async function runAudit(
  body: AuditBody,
  queryStrict?: string,
  headerStrict?: string,
  onProgress?: (ev: AgentTraceEvent) => void,
) {
  const orch = new AuditOrchestrator();
  if (onProgress) orch.setProgressHandler(onProgress);
  try {
    return await orch.auditRun(
      body?.audienceMode ?? "clinician",
      normalizeLocale(body?.locale),
      {
        strict: parseStrict(body?.strict, queryStrict, headerStrict),
        meds: body?.meds,
        case: body?.case ?? body?.caseSummary,
        visionSource: body?.visionSource,
      },
    );
  } catch (e) {
    if (e instanceof PartnerNotLiveError) {
      throw new HttpException(
        { message: e.message, partners: e.partners },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (e instanceof VisionOcrRequiredError) {
      throw new HttpException(
        { message: e.message, code: "VISION_OCR_REQUIRED" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw e;
  }
}

function writeSse(res: Response, event: string, data: unknown) {
  // Immediate chunk flush so FE sees Tavily/Daytona before Nosana settles.
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const flushable = res as Response & {
    flush?: () => void;
    flushHeaders?: () => void;
  };
  flushable.flushHeaders?.();
  flushable.flush?.();
  // Node HTTP: nudge socket when compression/proxy buffers.
  const sock = (res as Response & { socket?: { cork?: () => void; uncork?: () => void } })
    .socket;
  sock?.uncork?.();
}

async function streamAudit(
  res: Response,
  body: AuditBody,
  queryStrict?: string,
  headerStrict?: string,
) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
  try {
    const result = await runAudit(body, queryStrict, headerStrict, (ev) =>
      writeSse(res, "progress", ev),
    );
    writeSse(res, "result", result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      e instanceof HttpException
        ? e.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      e instanceof HttpException ? e.getResponse() : { message };
    writeSse(res, "error", { status, payload, message });
  }
  res.end();
}

@Controller("api/audit")
export class AuditController {
  @Post("run")
  async run(
    @Body() body: AuditBody,
    @Res() res: Response,
    @Query("strict") queryStrict?: string,
    @Query("stream") queryStream?: string,
    @Headers("x-partner-strict") headerStrict?: string,
    @Headers("accept") accept?: string,
  ) {
    if (wantsStream(body, queryStream, accept)) {
      await streamAudit(res, body, queryStrict, headerStrict);
      return;
    }
    try {
      const result = await runAudit(body, queryStrict, headerStrict);
      res.status(200).json(result);
    } catch (e) {
      if (e instanceof HttpException) {
        const status = e.getStatus();
        res.status(status).json(e.getResponse());
        return;
      }
      throw e;
    }
  }

  @Post("run/stream")
  async runStream(
    @Body() body: AuditBody,
    @Res() res: Response,
    @Query("strict") queryStrict?: string,
    @Headers("x-partner-strict") headerStrict?: string,
  ) {
    await streamAudit(res, body, queryStrict, headerStrict);
  }

  @Post("simulate")
  async simulate(
    @Body() body: AuditBody,
    @Res() res: Response,
    @Query("strict") queryStrict?: string,
    @Headers("x-partner-strict") headerStrict?: string,
  ) {
    try {
      const result = await runAudit(body, queryStrict, headerStrict);
      res.status(200).json(result);
    } catch (e) {
      if (e instanceof HttpException) {
        res.status(e.getStatus()).json(e.getResponse());
        return;
      }
      throw e;
    }
  }
}
