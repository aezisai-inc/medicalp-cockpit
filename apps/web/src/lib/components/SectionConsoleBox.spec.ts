import { describe, expect, it } from "vitest";

type ConsoleLine = { id: string; step: string; message: string; source?: string };

/** Mirror SectionConsoleBox lane filter (unit, no DOM). */
function matchesLane(line: ConsoleLine, lane: string): boolean {
  const step = (line.step || "").toLowerCase();
  const needle = lane.toLowerCase();
  if (step === needle) return true;
  if (step.includes(needle)) return true;
  const short = needle.split(".").pop() || needle;
  return step.includes(short);
}

export function filterByLanes(lines: ConsoleLine[], lanes: string[]): ConsoleLine[] {
  return lines.filter((line) =>
    !lanes.length ? true : lanes.some((lane) => matchesLane(line, lane)),
  );
}

describe("SectionConsoleBox lane filter", () => {
  const lines: ConsoleLine[] = [
    { id: "1", step: "Tavily", message: "hits=2", source: "live" },
    { id: "2", step: "Nosana.narrative", message: "draft", source: "fixture" },
    { id: "3", step: "Daytona", message: "destroyed", source: "live" },
    { id: "4", step: "Mask.purge", message: "cleared", source: "live" },
    { id: "5", step: "Scan.ingest", message: "bytes", source: "live" },
  ];

  it("Col1 lanes keep scan/vision/mask only", () => {
    const out = filterByLanes(lines, [
      "Scan.ingest",
      "Nosana.vision",
      "Mask.apply",
      "Mask.purge",
    ]);
    expect(out.map((l) => l.step)).toEqual(["Mask.purge", "Scan.ingest"]);
  });

  it("Col3 lanes keep Daytona + Tavily", () => {
    const out = filterByLanes(lines, ["Daytona", "Tavily"]);
    expect(out.map((l) => l.step)).toEqual(["Tavily", "Daytona"]);
  });

  it("Col2 lanes keep Daytona + CodeAF + Nosana.narrative", () => {
    const out = filterByLanes(lines, ["Daytona", "CodeAF", "Nosana.narrative"]);
    expect(out.map((l) => l.step)).toEqual(["Nosana.narrative", "Daytona"]);
  });
});
