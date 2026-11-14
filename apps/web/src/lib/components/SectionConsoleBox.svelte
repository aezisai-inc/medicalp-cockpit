<script lang="ts">
  import type { ConsoleLine } from "$lib/components/AgentConsoleLog.svelte";

  let {
    title = "$ section --tail",
    lanes = [] as string[],
    lines = [] as ConsoleLine[],
  }: {
    title?: string;
    lanes?: string[];
    lines?: ConsoleLine[];
  } = $props();

  function matchesLane(line: ConsoleLine, lane: string): boolean {
    const step = (line.step || "").toLowerCase();
    const needle = lane.toLowerCase();
    if (step === needle) return true;
    if (step.includes(needle)) return true;
    // Nosana.narrative ↔ nosana; Mask.apply ↔ mask
    const short = needle.split(".").pop() || needle;
    return step.includes(short);
  }

  const filtered = $derived(
    (lines || [])
      .filter((line) =>
        !lanes.length ? true : lanes.some((lane) => matchesLane(line, lane)),
      )
      .slice(-6),
  );

  function srcLabel(source?: ConsoleLine["source"]) {
    if (source === "live") return "LIVE";
    if (source === "live-cache") return "CACHE";
    if (source === "fixture") return "SEED";
    if (source === "running") return "…";
    return "INFO";
  }
</script>

<section class="sec-console" data-testid="section-console" data-lanes={lanes.join(",")}>
  <header class="bar">
    <span class="prompt">{title}</span>
  </header>
  <pre class="body"><code>{#each filtered as line (line.id)}
<span class="row" class:running={line.running} data-source={line.source ?? "info"}>[{line.elapsed ?? "--"}] [{line.step}] {srcLabel(line.source)} {line.message}{#if line.durationMs != null} ({line.durationMs}ms){/if}
</span>
{:else}
<span class="idle">waiting…</span>
{/each}</code></pre>
</section>

<style>
  .sec-console {
    margin: 0.45rem 0 0.65rem;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #1e293b;
    background: #0b1220;
    max-height: 9.5rem;
  }
  .bar {
    padding: 0.28rem 0.55rem;
    background: #111827;
    border-bottom: 1px solid #1f2937;
  }
  .prompt {
    font-size: 0.58rem;
    color: #94a3b8;
    letter-spacing: 0.03em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .body {
    margin: 0;
    padding: 0.4rem 0.55rem 0.5rem;
    font-size: 0.58rem;
    line-height: 1.35;
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: auto;
    max-height: 7.5rem;
  }
  .row.running {
    color: #fbbf24;
  }
  .idle {
    color: #64748b;
  }
</style>
