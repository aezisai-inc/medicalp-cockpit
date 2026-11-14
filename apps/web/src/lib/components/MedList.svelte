<script lang="ts">
  import { get } from "svelte/store";
  import { locale } from "$lib/i18n/locale";
  import { t, translate } from "$lib/i18n/t";
  import type { MessageKey } from "$lib/i18n/messages/ja";

  export type Med = {
    id: string;
    name: string;
    usage: string;
    active: boolean;
    psychDependency: "NONE" | "HIGH";
    annualCost: number;
    recommendation: string;
    rationale?: string;
    guidelineRef?: string;
    expectedImprovement?: string;
    clinic?: string;
    dosesPerDay?: number;
  };

  type Mode = "clinician" | "family";
  type Bucket = "stop" | "taper" | "continue";

  interface Props {
    meds: Med[];
    audienceMode: Mode;
    onChangeRecommendation?: (id: string, rec: Bucket) => void;
    onPharmacistApprove?: () => void;
    pharmacistApproved?: boolean;
    audited?: boolean;
    preAudit?: boolean;
    dailyDosesBefore?: number;
    dailyDosesAfter?: number;
  }

  let {
    meds,
    audienceMode,
    onChangeRecommendation,
    onPharmacistApprove,
    pharmacistApproved = false,
    audited = false,
    preAudit = false,
    dailyDosesBefore = 4,
    dailyDosesAfter = 1,
  }: Props = $props();

  function bucketOf(m: Med): Bucket {
    const r = (m.recommendation || "").toLowerCase();
    if (r === "stop") return "stop";
    if (r === "taper") return "taper";
    return "continue";
  }

  function fallbackKey(bucket: Bucket): MessageKey {
    if (bucket === "stop") return "rationaleFallbackStop";
    if (bucket === "taper") return "rationaleFallbackTaper";
    return "rationaleFallbackContinue";
  }

  function displayRationale(m: Med): string {
    if (m.rationale && m.rationale.trim()) return m.rationale;
    return translate(get(locale), fallbackKey(bucketOf(m)));
  }

  const bucketCounts = $derived({
    stop: meds.filter((m) => bucketOf(m) === "stop").length,
    taper: meds.filter((m) => bucketOf(m) === "taper").length,
    continue: meds.filter((m) => bucketOf(m) === "continue").length,
  });

  const activeCount = $derived(meds.filter((m) => m.active).length);
  const morningBundleCount = $derived(
    meds.filter((m) => {
      const b = bucketOf(m);
      return b === "continue" || b === "taper";
    }).length,
  );
  const clinicSet = $derived([...new Set(meds.map((m) => m.clinic).filter(Boolean))]);

  function onSelect(m: Med, e: Event) {
    e.stopPropagation();
    const v = (e.currentTarget as HTMLSelectElement).value as Bucket;
    if (m.psychDependency === "HIGH" && v === "stop") return;
    onChangeRecommendation?.(m.id, v);
  }
</script>

<div class="med-head">
  <h3>
    {audienceMode === "clinician" ? $t("medListClinician") : $t("medListFamily")}
  </h3>
  <div class="head-counts">
    <span class="bucket-summary" data-testid="med-bucket-counts">
      {$t("bucketCounts", {
        stop: bucketCounts.stop,
        taper: bucketCounts.taper,
        continue: bucketCounts.continue,
      })}
    </span>
    <span class="badge-count">
      {#if audited}
        {$t("medCountAfter", { n: morningBundleCount })}
      {:else if preAudit}
        {$t("medCountPreAudit", { n: meds.length || activeCount })}
      {:else}
        {#if clinicSet.length > 0}
          {$t("medCountWithClinics", { n: meds.length || activeCount, clinics: clinicSet.length })}
        {:else}
          {$t("medCountNoClinic", { n: meds.length || activeCount })}
        {/if}
      {/if}
    </span>
    {#if audited && dailyDosesBefore > dailyDosesAfter}
      <span class="dose-pill" data-testid="dose-agg-pill">
        {$t("doseAggPill")}（{dailyDosesBefore}→{dailyDosesAfter}）
      </span>
    {/if}
    {#if clinicSet.length}
      <span class="clinic-row" data-testid="clinic-badges">
        {#each clinicSet as c}
          <span class="clinic-badge">{c}</span>
        {/each}
      </span>
    {/if}
  </div>
</div>

<ul class="meds" data-testid="med-list">
  {#each meds as m (m.id)}
    {@const bucket = bucketOf(m)}
    <li class:lock={m.psychDependency === "HIGH"} class:off={!m.active} data-rec={bucket}>
      <div class="med-header">
        <div class="med-title">
          <strong>{m.name}</strong>
          <span class="usage">
            {m.usage}
            {#if m.clinic}
              <span class="clinic-inline" title={$t("clinicBadge")}>{m.clinic}</span>
            {/if}
          </span>
        </div>
        <div class="med-controls">
          {#if m.psychDependency === "HIGH"}
            <span class="badge lock-badge" data-testid="lock-badge">{$t("lockBadge")}</span>
          {/if}
          <select
            class="rec-select"
            class:stop={bucket === "stop"}
            class:taper={bucket === "taper"}
            class:continue={bucket === "continue"}
            data-testid="med-rec-select"
            aria-label="recommendation"
            value={bucket}
            onchange={(e) => onSelect(m, e)}
          >
            <option value="stop" disabled={m.psychDependency === "HIGH"}>{$t("stopBadge")}</option>
            <option value="taper">{$t("taperBadge")}</option>
            <option value="continue">{$t("continueBadge")}</option>
          </select>
        </div>
      </div>
      <div class="evidence-body" data-testid="med-rationale">
        <p class="why">{displayRationale(m)}</p>
        {#if m.guidelineRef}
          <p class="ref">{$t("guidelineRefLabel")}: {m.guidelineRef}</p>
        {/if}
      </div>
    </li>
  {/each}
</ul>
<p class="hint">{$t("medHint")}</p>
<button
  type="button"
  class="pharm-approve"
  data-testid="pharmacist-approve"
  disabled={pharmacistApproved || meds.length === 0}
  onclick={() => onPharmacistApprove?.()}
>
  {pharmacistApproved ? $t("pharmacistApprovedBadge") : $t("pharmacistApprove")}
</button>

<style>
  .med-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0.5rem 0 0.35rem;
  }
  h3 {
    margin: 0;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
  }
  .head-counts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
  }
  .bucket-summary {
    font-size: 0.68rem;
    font-weight: 700;
    color: #0f172a;
  }
  .badge-count {
    font-size: 0.65rem;
    color: #64748b;
  }
  .dose-pill {
    font-size: 0.62rem;
    font-weight: 700;
    color: #0f766e;
    background: #ecfdf5;
    border: 1px solid #99f6e4;
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
  }
  .clinic-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    justify-content: flex-end;
    max-width: 12rem;
  }
  .clinic-badge,
  .clinic-inline {
    font-size: 0.6rem;
    font-weight: 700;
    color: #1e40af;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 999px;
    padding: 0.1rem 0.35rem;
  }
  .clinic-inline {
    margin-left: 0.25rem;
  }
  .meds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  li {
    border: 1px solid #e2e8f0;
    border-radius: 0.55rem;
    background: #fff;
    overflow: hidden;
  }
  li.lock {
    border-color: #fbbf24;
  }
  li.off {
    opacity: 0.85;
  }
  .med-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
    padding: 0.55rem 0.6rem;
  }
  .med-title {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .med-title strong {
    font-size: 0.82rem;
    color: #0f172a;
  }
  .usage {
    font-size: 0.68rem;
    color: #64748b;
  }
  .med-controls {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .badge {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
  }
  .lock-badge {
    background: #fef3c7;
    color: #92400e;
  }
  .rec-select {
    font-size: 0.72rem;
    font-weight: 700;
    border: 1px solid #cbd5e1;
    border-radius: 0.4rem;
    padding: 0.35rem 0.4rem;
    background: #f8fafc;
    color: #334155;
  }
  .rec-select.stop {
    border-color: #fca5a5;
    background: #fef2f2;
    color: #b91c1c;
  }
  .rec-select.taper {
    border-color: #fdba74;
    background: #fff7ed;
    color: #c2410c;
  }
  .rec-select.continue {
    border-color: #99f6e4;
    background: #ecfdf5;
    color: #0f766e;
  }
  .evidence-body {
    border-top: 1px solid #e2e8f0;
    padding: 0.55rem 0.65rem 0.65rem;
    background: #f8fafc;
  }
  .why {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #334155;
  }
  .ref {
    margin: 0.35rem 0 0;
    font-size: 0.68rem;
    color: #64748b;
  }
  .hint {
    margin: 0.45rem 0 0.55rem;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .pharm-approve {
    width: 100%;
    border: 0;
    border-radius: 0.55rem;
    padding: 0.7rem 0.8rem;
    font-weight: 700;
    font-size: 0.85rem;
    color: #fff;
    background: linear-gradient(135deg, #059669, #10b981);
    cursor: pointer;
  }
  .pharm-approve:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
