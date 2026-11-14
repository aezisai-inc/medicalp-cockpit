<script lang="ts">
  export type PartnerName = "Nosana" | "Tavily" | "CodeAF" | "Daytona";
  export type PartnerSource = "live" | "live-cache" | "fixture" | "idle" | "running" | "error";

  let {
    name,
    source = "live",
    label = "",
  }: {
    name: PartnerName;
    source?: PartnerSource;
    /** Display override (e.g. Nosana Vision / PHI Mask / Nosana LLM / Daytona Sandbox). */
    label?: string;
  } = $props();

  const displayName = $derived(label?.trim() || name);

  const suffix = $derived(
    source === "live"
      ? "LIVE"
      : source === "live-cache"
        ? "CACHE"
        : source === "fixture"
          ? "SEED"
          : source === "running"
            ? "…"
            : source === "error"
              ? "ERR"
              : "",
  );
</script>

<span class="badge" data-partner={name} data-source={source} title="{displayName} · {suffix || source}">
  <span class="name">{displayName}</span>
  {#if suffix}<span class="src">{suffix}</span>{/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    border: 1px solid rgba(100, 116, 139, 0.45);
    background: rgba(248, 250, 252, 0.95);
    color: #0f172a;
    vertical-align: middle;
  }
  .badge[data-source="live"] {
    border-color: rgba(16, 185, 129, 0.55);
    background: rgba(236, 253, 245, 0.95);
  }
  .badge[data-source="live-cache"],
  .badge[data-source="fixture"] {
    border-color: rgba(245, 158, 11, 0.55);
    background: rgba(255, 251, 235, 0.95);
  }
  .src {
    opacity: 0.85;
    font-size: 0.58rem;
  }
</style>
