<script lang="ts">
  export type PartnerLane =
    | "idle"
    | "running"
    | "live"
    | "live-cache"
    | "fixture"
    | "error";

  export type PartnerDockState = {
    vision: PartnerLane;
    mask: PartnerLane;
    tavily: PartnerLane;
    codeaf: PartnerLane;
    daytona: PartnerLane;
    visionLabel?: string;
    daytonaDetail?: string;
  };

  let {
    state,
    compact = false,
  }: {
    state: PartnerDockState;
    compact?: boolean;
  } = $props();

  const lanes: {
    key: keyof Omit<PartnerDockState, "visionLabel" | "daytonaDetail">;
    label: string;
  }[] = [
    { key: "vision", label: "Vision" },
    { key: "mask", label: "Mask" },
    { key: "tavily", label: "Tavily" },
    { key: "codeaf", label: "CodeAF" },
    { key: "daytona", label: "Daytona" },
  ];

  export function laneStatusShort(lane: PartnerLane): string {
    const map: Record<PartnerLane, string> = {
      idle: "STANDBY",
      running: "CONNECTING",
      live: "LIVE",
      "live-cache": "CACHE",
      fixture: "SEED",
      error: "ERROR",
    };
    return map[lane] ?? lane.toUpperCase();
  }

  function visionProductName(): string {
    return "Nosana GPU Vision";
  }

  function rowLabel(key: (typeof lanes)[number]["key"]): string {
    if (key === "vision") {
      return state.visionLabel?.split(" · ")[0] ?? visionProductName();
    }
    return lanes.find((l) => l.key === key)?.label ?? key;
  }

  function caption(key: (typeof lanes)[number]["key"], lane: PartnerLane): string {
    const st = laneStatusShort(lane);
    const name = rowLabel(key);
    if (key === "daytona" && state.daytonaDetail && (lane === "live" || lane === "running")) {
      return `${name} · ${st} · ${state.daytonaDetail}`;
    }
    return `${name} · ${st}`;
  }
</script>

<aside
  class="dock"
  class:compact
  data-testid="partner-status-dock"
  aria-label="Partner live status"
>
  {#each lanes as { key, label }}
    {@const lane = state[key]}
    <div class="pill" data-lane={lane} data-partner={key} title={caption(key, lane)}>
      <span class="dot" class:pulse={lane === "running"}></span>
      {#if !compact}
        <span class="lab">{rowLabel(key)}</span>
        <span class="st">{laneStatusShort(lane)}</span>
      {/if}
    </div>
  {/each}
</aside>

<style>
  .dock {
    position: fixed;
    bottom: 0.75rem;
    right: 0.75rem;
    z-index: 40;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-width: min(92vw, 28rem);
    justify-content: flex-end;
    pointer-events: none;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.55rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.82);
    color: #e2e8f0;
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    border: 1px solid rgba(148, 163, 184, 0.35);
    backdrop-filter: blur(8px);
  }
  .compact .pill {
    padding: 0.22rem;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #94a3b8;
  }
  .pill[data-lane="running"] .dot {
    background: #fbbf24;
  }
  .pill[data-lane="live"] .dot {
    background: #34d399;
  }
  .pill[data-lane="live-cache"] .dot,
  .pill[data-lane="fixture"] .dot {
    background: #f59e0b;
  }
  .pill[data-lane="error"] .dot {
    background: #fb7185;
  }
  .pulse {
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.85);
    }
  }
  .lab {
    font-weight: 600;
    max-width: 9.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    opacity: 0.9;
    font-weight: 700;
  }
</style>
