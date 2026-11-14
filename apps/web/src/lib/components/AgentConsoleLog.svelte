<script lang="ts">
  export type ConsoleLine = {
    id: string;
    elapsed?: string;
    step: string;
    source?: "live" | "live-cache" | "fixture" | "running" | "info";
    message: string;
    durationMs?: number;
    running?: boolean;
  };

  let {
    lines = [],
    title = "$ aria-agent run --mode=move-in-audit --phi-guard=strict",
  }: {
    lines?: ConsoleLine[];
    title?: string;
  } = $props();

  function srcLabel(source?: ConsoleLine["source"]) {
    if (source === "live") return "LIVE";
    if (source === "live-cache") return "CACHE";
    if (source === "fixture") return "SEED";
    if (source === "running") return "…";
    return "INFO";
  }
</script>

<section class="console" data-testid="agent-console" aria-label="Agent execution console">
  <header class="bar">
    <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="ttl">Agent Execution Console · 5 lanes</span>
  </header>
  <pre class="body"><code>{title}
{#each lines as line (line.id)}
<span class="row" class:running={line.running} data-source={line.source ?? "info"}>[{line.elapsed ?? "--:--.---"}] [{line.step.padEnd(16)}] {srcLabel(line.source).padEnd(5)} {line.message}{#if line.durationMs != null} ({line.durationMs.toLocaleString()}ms){/if}
</span>
{/each}</code></pre>
</section>

<style>
  .console {
    margin: 0.75rem 0 0;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #1e293b;
    background: #0b1220;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.65rem;
    background: #111827;
    border-bottom: 1px solid #1f2937;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
  }
  .dot.r {
    background: #f87171;
  }
  .dot.y {
    background: #fbbf24;
  }
  .dot.g {
    background: #34d399;
  }
  .ttl {
    margin-left: 0.45rem;
    font-size: 0.65rem;
    color: #94a3b8;
    letter-spacing: 0.04em;
  }
  .body {
    margin: 0;
    padding: 0.65rem 0.75rem 0.85rem;
    max-height: 220px;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.68rem;
    line-height: 1.45;
    color: #e2e8f0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .row[data-source="live"] {
    color: #bbf7d0;
  }
  .row[data-source="live-cache"] {
    color: #fde68a;
  }
  .row[data-source="fixture"] {
    color: #fdba74;
  }
  .row.running {
    color: #93c5fd;
  }
  .row[data-source="info"] {
    color: #cbd5e1;
  }
</style>
