import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TraceSource } from "../domain/types";

export function liveCacheRoot(): string {
  // Lambda /var/task is read-only — prefer /tmp for runtime writes.
  const candidates = [
    join("/tmp", "care-audit-live-cache"),
    join(process.cwd(), "fixtures/live-cache"),
    join(process.cwd(), "../../fixtures/live-cache"),
    join(__dirname, "../../../../fixtures/live-cache"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function liveCacheReadRoots(): string[] {
  return [
    join("/tmp", "care-audit-live-cache"),
    join(process.cwd(), "fixtures/live-cache"),
    join(process.cwd(), "../../fixtures/live-cache"),
    join(__dirname, "../../../../fixtures/live-cache"),
  ];
}

export function readLiveCache<T>(slug: string): T | null {
  for (const root of liveCacheReadRoots()) {
    const p = join(root, `${slug}.json`);
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      /* try next root */
    }
  }
  return null;
}

export function writeLiveCache(slug: string, payload: unknown): void {
  // Never throw — Lambda EROFS on /var/task must not demote a successful live call.
  try {
    const root = liveCacheRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `${slug}.json`), JSON.stringify(payload, null, 2));
  } catch {
    /* ignore cache persistence failures */
  }
}

type Hit = { title: string; url?: string; snippet?: string };

const FIXTURE_HITS: Hit[] = [
  { title: "Deprescribing PPI in older adults (fixture)", url: "https://example.org/fixture" },
];

function fromCache(): { hits: Hit[]; source: TraceSource } | null {
  const cached = readLiveCache<{ hits: Hit[] }>("tavily-search");
  if (cached?.hits?.length) {
    return { hits: cached.hits, source: "live-cache" };
  }
  return null;
}

/** Tavily required for pitch. Prefer live → live-cache → fixture (never label fixture as live). */
export async function searchEvidence(query: string): Promise<{
  hits: Hit[];
  source: TraceSource;
}> {
  const key = process.env.TAVILY_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query:
            query ||
            "deprescribing elderly PPI benzodiazepine 高齢者 医薬品適正使用 指針",
          max_results: 3,
          include_answer: false,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: { title: string; url: string; content?: string }[];
        };
        const hits = (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 180),
        }));
        writeLiveCache("tavily-search", { hits, query });
        return { hits, source: "live" };
      }
    } catch {
      /* fall through to live-cache */
    }
  }
  return fromCache() ?? { hits: FIXTURE_HITS, source: "fixture" };
}
