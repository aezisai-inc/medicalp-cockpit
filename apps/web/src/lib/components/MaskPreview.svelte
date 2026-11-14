<script lang="ts">
  import { t } from "$lib/i18n/t";

  export type PhiBox = {
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };

  export type ImageNatural = {
    width: number;
    height: number;
  };

  interface Props {
    visible?: boolean;
    phase?: "idle" | "scanning" | "masked" | "purged";
    regionCount?: number;
    imageSrc?: string | null;
    summaryText?: string;
    personaSummary?: string;
    boxes?: PhiBox[];
    imageNatural?: ImageNatural;
    proof?: {
      regions: number;
      egress: number;
      labels: string[];
      sha256: string;
    } | null;
    onClear?: () => void;
    clearBusy?: boolean;
  }

  let {
    visible = false,
    phase = "idle",
    regionCount = 0,
    imageSrc = "/fixtures/paper-scan/souvenir-notebook-v1.jpg",
    summaryText: _summaryText = "",
    personaSummary: _personaSummary = "",
    boxes = [],
    imageNatural = { width: 1240, height: 1754 },
    proof = null,
    onClear,
    clearBusy = false,
  }: Props = $props();

  const nw = $derived(Math.max(1, imageNatural?.width || 1240));
  const nh = $derived(Math.max(1, imageNatural?.height || 1754));
  const aspect = $derived(`${nw} / ${nh}`);
  const overlayBoxes = $derived(
    (boxes?.length ? boxes : []).map((b) => ({
      label: b.label,
      left: `${(b.x / nw) * 100}%`,
      top: `${(b.y / nh) * 100}%`,
      width: `${(b.w / nw) * 100}%`,
      height: `${(b.h / nh) * 100}%`,
    })),
  );
  const showImage = $derived(Boolean(imageSrc) && phase !== "purged");
</script>

{#if visible}
  <div class="mask-wrap" data-testid="mask-preview" aria-live="polite">
    <div class="stage" style={`aspect-ratio: ${aspect}`}>
      {#if showImage}
        <img
          src={imageSrc}
          alt=""
          class="scan-img"
          data-testid="mask-scan-img"
          aria-hidden="true"
        />
        {#each overlayBoxes as box (box.label + box.left + box.top)}
          <div
            class="phi-box"
            class:scanning={phase === "scanning"}
            class:masked={phase === "masked"}
            style={`left:${box.left};top:${box.top};width:${box.width};height:${box.height}`}
            title={`PHI MASKED: ${box.label}`}
            data-testid="phi-box"
            data-label={box.label}
          ></div>
        {/each}
      {:else}
        <div class="purged" data-testid="mask-purged">
          <p class="title">{$t("maskTitle")}</p>
          <p class="legend">{$t("maskPurged")}</p>
        </div>
      {/if}
    </div>
    <div class="footer">
      <p class="legend">
        {#if phase === "masked"}
          {$t("maskLegendDone", { n: regionCount || overlayBoxes.length || 0 })}
        {:else if phase === "scanning"}
          {$t("maskLegendScan")}
        {:else if phase === "purged"}
          {$t("maskPurged")}
        {:else}
          {$t("maskLegendIdle")}
        {/if}
      </p>
      {#if onClear && (phase === "masked" || phase === "scanning")}
        <button
          type="button"
          class="clear-btn"
          data-testid="clear-image"
          disabled={clearBusy}
          onclick={() => onClear?.()}
        >
          {$t("clearImage")}
        </button>
      {/if}
    </div>
    {#if proof}
      <dl class="proof" data-testid="proof-strip" data-phase={phase}>
        <div><dt>regions</dt><dd data-testid="proof-regions">{proof.regions}</dd></div>
        <div><dt>egress</dt><dd>{proof.egress}</dd></div>
        <div>
          <dt>labels</dt>
          <dd data-testid="proof-labels">
            {#if proof.labels?.length}
              <span class="label-badges">
                {#each proof.labels as lb (lb)}
                  <span class="lbl">{lb}</span>
                {/each}
              </span>
            {:else}
              —
            {/if}
          </dd>
        </div>
        <div><dt>sha256</dt><dd>{proof.sha256}</dd></div>
      </dl>
    {/if}
  </div>
{/if}

<style>
  .mask-wrap {
    margin: 0.5rem 0 0.75rem;
    padding: 0.65rem;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .stage {
    position: relative;
    width: 100%;
    max-height: 280px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px dashed #cbd5e1;
    background: #0f172a;
  }
  .scan-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    pointer-events: none;
  }
  .phi-box {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    background: #0a0a0a;
    border: 1px solid #1e293b;
    border-radius: 2px;
  }
  .phi-box.scanning {
    border-color: #ef4444;
    background: rgba(15, 23, 42, 0.85);
    box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.45);
  }
  .phi-box.masked {
    background: #000;
    border-color: #111;
  }
  .purged {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.8rem;
    color: #cbd5e1;
    font-size: 0.7rem;
  }
  .title {
    margin: 0;
    font-weight: 700;
    color: #f8fafc;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .legend {
    margin: 0;
    font-size: 0.68rem;
    color: #475569;
  }
  .clear-btn {
    flex-shrink: 0;
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #0f172a;
    border-radius: 8px;
    padding: 0.28rem 0.55rem;
    font-size: 0.68rem;
    cursor: pointer;
  }
  .clear-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .proof {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 0.75rem;
    margin: 0;
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    background: #0b1220;
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.62rem;
  }
  .proof div {
    display: flex;
    gap: 0.35rem;
  }
  .proof dt {
    margin: 0;
    color: #94a3b8;
  }
  .proof dd {
    margin: 0;
    word-break: break-all;
  }
  .label-badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .lbl {
    display: inline-block;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.45);
    background: rgba(30, 41, 59, 0.85);
    font-size: 0.55rem;
    color: #f8fafc;
  }
</style>
