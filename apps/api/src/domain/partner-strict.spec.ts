import { describe, expect, it, afterEach } from "vitest";
import {
  isPartnerStrict,
  PartnerNotLiveError,
} from "./orchestrator";

describe("partner strict gate", () => {
  const prev = process.env.PARTNER_MODE;
  afterEach(() => {
    if (prev === undefined) delete process.env.PARTNER_MODE;
    else process.env.PARTNER_MODE = prev;
  });

  it("isPartnerStrict: env live-required", () => {
    process.env.PARTNER_MODE = "live-required";
    expect(isPartnerStrict(false)).toBe(true);
    expect(isPartnerStrict(undefined)).toBe(true);
  });

  it("isPartnerStrict: request strict on auto", () => {
    process.env.PARTNER_MODE = "auto";
    expect(isPartnerStrict(true)).toBe(true);
    expect(isPartnerStrict(false)).toBe(false);
  });

  it("PartnerNotLiveError carries 503", () => {
    const err = new PartnerNotLiveError(["Vision=live-cache"]);
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain("Vision=live-cache");
  });
});
