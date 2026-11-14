<script lang="ts">
  import { t } from "$lib/i18n/t";
  import PartnerServiceBadge, {
    type PartnerSource,
  } from "./PartnerServiceBadge.svelte";

  type DualPayload = {
    clinical?: unknown;
    family?: unknown;
    form2?: {
      title: string;
      pointsNote: string;
      sections: string[];
      facility?: string;
      consult?: string;
      observation?: string[];
      observationPlan?: string[];
      evaluationBullets?: string[];
      consent?: {
        text: string;
        consentedParties?: string[];
        pharmacistName?: string;
      };
      buckets?: {
        stop: string[];
        taper: string[];
        continue: string[];
        counts: { stop: number; taper: number; continue: number };
      };
      medSummary: {
        name: string;
        usage?: string;
        active: boolean;
        psychLock: boolean;
        recommendation: string;
      }[];
    };
  };

  interface Props {
    open: boolean;
    dual: DualPayload | null;
    familyConsented?: boolean;
    audienceMode?: "clinician" | "family";
    onClose: () => void;
    daytonaSource?: PartnerSource;
    codeafSource?: PartnerSource;
    nosanaSource?: PartnerSource;
    tavilySource?: PartnerSource;
    evidenceHits?: { title: string; url?: string; snippet?: string }[];
  }
  let {
    open,
    dual,
    familyConsented = false,
    audienceMode = "clinician",
    onClose,
    daytonaSource = "live",
    codeafSource = "live",
    nosanaSource = "live",
    tavilySource = "idle",
    evidenceHits = [],
  }: Props = $props();

  const form2 = $derived(dual?.form2);
  const obs = $derived(form2?.observationPlan ?? form2?.observation ?? []);
  const bullets = $derived(form2?.evaluationBullets ?? []);
  const evidenceList = $derived(evidenceHits.slice(0, 5));

  function recLabel(rec: string): string {
    const r = (rec || "").toLowerCase();
    if (r === "stop") return "中止";
    if (r === "taper") return "漸減";
    return "継続";
  }

  function onPrint() {
    window.print();
  }
</script>

{#if open && dual && form2}
  <div class="backdrop" role="presentation" onclick={onClose}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dual-title" data-testid="dual-modal">
    <header>
      <div>
        <span class="chip">{$t("dualChip")}</span>
        <h2 id="dual-title">{form2.title}</h2>
        <p class="points">{form2.pointsNote}</p>
      </div>
      <button type="button" class="close" onclick={onClose} aria-label={$t("dualClose")}>×</button>
    </header>

    <article class="form2" data-testid="form2-preview">
      <section class="block" data-testid="form2-section-2">
        <h3>2. 現在服用中の薬剤一覧</h3>
        <table class="med-table">
          <thead>
            <tr>
              <th>薬剤名</th>
              <th>用法</th>
              <th>提案</th>
              <th>継続</th>
            </tr>
          </thead>
          <tbody>
            {#each form2.medSummary as m}
              <tr data-rec={m.recommendation}>
                <td>{m.name}</td>
                <td>{m.usage ?? "—"}</td>
                <td>{recLabel(m.recommendation)}</td>
                <td>{m.active ? "✓" : "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>

      <section class="block" data-testid="form2-section-3">
        <h3>
          3. 服用薬剤総合評価の結果（要約）
          <PartnerServiceBadge name="Tavily" source={tavilySource} />
          <PartnerServiceBadge name="Daytona" source={daytonaSource} />
          <PartnerServiceBadge name="CodeAF" source={codeafSource} />
        </h3>
        {#if bullets.length}
          <ul class="eval" data-testid="form2-evaluation-bullets">
            {#each bullets as b}
              <li>{b}</li>
            {/each}
          </ul>
        {/if}
        {#if evidenceList.length}
          <div class="evidence" data-testid="form2-tavily-evidence">
            <h4>Tavily 根拠</h4>
            <ul>
              {#each evidenceList as e}
                <li>
                  {#if e.url}
                    <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a>
                  {:else}
                    {e.title}
                  {/if}
                  {#if e.snippet}
                    <p>{e.snippet}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if form2.buckets}
          <div class="buckets" data-testid="form2-buckets">
            <div class="b stop">
              <strong>中止 {form2.buckets.counts.stop}</strong>
              <span>{form2.buckets.stop.join(" · ") || "—"}</span>
            </div>
            <div class="b taper">
              <strong>漸減 {form2.buckets.counts.taper}</strong>
              <span>{form2.buckets.taper.join(" · ") || "—"}</span>
            </div>
            <div class="b cont">
              <strong>継続 {form2.buckets.counts.continue}</strong>
              <span>{form2.buckets.continue.join(" · ") || "—"}</span>
            </div>
          </div>
        {/if}
      </section>

      <section class="block" data-testid="form2-section-4">
        <h3>
          4. 観察計画及び対応案
          <PartnerServiceBadge name="Nosana" source={nosanaSource} />
        </h3>
        {#if obs.length}
          <ul class="obs">
            {#each obs as o}
              <li>{o}</li>
            {/each}
          </ul>
        {/if}
        <ul class="meds">
          {#each form2.medSummary as m}
            <li>
              {m.name}
              {#if m.psychLock} · {$t("psychTaper")}{/if}
              — {m.recommendation}
            </li>
          {/each}
        </ul>
      </section>

      <section class="block consent-block" data-testid="form2-section-5">
        <h3>5. 患者・家族への説明と同意</h3>
        <p class="consent-text">
          {form2.consent?.text ?? $t("familyConsent")}
        </p>
        <p
          class="consent-stamp"
          data-testid="form2-consent-stamp"
          class:on={familyConsented || audienceMode === "family"}
        >
          {#if familyConsented}
            ✓ {$t("familyConsentStamp")}
          {:else}
            □ {form2.consent?.text ?? $t("familyConsent")}
          {/if}
        </p>
        {#if form2.consent?.pharmacistName}
          <p class="sign">保険薬剤師氏名：{form2.consent.pharmacistName}</p>
        {/if}
      </section>
    </article>

    <footer>
      <button type="button" class="secondary" onclick={onClose}>{$t("dualClose")}</button>
      <button type="button" class="secondary print" data-testid="form2-print" onclick={onPrint}>
        {$t("dualPrint")}
      </button>
      <button type="button" class="primary" onclick={onClose}>{$t("dualConfirm")}</button>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(4px);
    z-index: 40;
  }
  .modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 50;
    width: min(720px, calc(100vw - 2rem));
    max-height: 90vh;
    overflow: auto;
    background: #fff;
    border-radius: 16px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 25px 50px rgba(15, 23, 42, 0.18);
    padding: 1.1rem 1.25rem 1rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 0.75rem;
    margin-bottom: 0.85rem;
  }
  .chip {
    font-size: 0.65rem;
    font-weight: 700;
    color: #0f766e;
    background: #f0fdfa;
    border: 1px solid #99f6e4;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
  }
  h2 {
    margin: 0.35rem 0 0;
    font-size: 1.05rem;
  }
  .points {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    color: #64748b;
  }
  .close {
    border: none;
    background: transparent;
    font-size: 1.5rem;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
  }
  .form2 {
    background: #fffaf5;
    border: 1px solid #fed7aa;
    border-radius: 12px;
    padding: 0.85rem;
  }
  .block {
    margin-bottom: 0.9rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #f1e4d5;
  }
  .block:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  h3 {
    margin: 0 0 0.45rem;
    font-size: 0.84rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .eval,
  .obs,
  .meds {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.74rem;
    color: #334155;
  }
  .evidence {
    margin: 0.55rem 0 0;
    font-size: 0.7rem;
  }
  .evidence h4 {
    margin: 0 0 0.3rem;
    font-size: 0.72rem;
    color: #0f766e;
  }
  .evidence ul {
    margin: 0;
    padding-left: 1rem;
  }
  .evidence a {
    color: #1d4ed8;
  }
  .evidence p {
    margin: 0.1rem 0 0.35rem;
    color: #64748b;
  }
  .med-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.72rem;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
  }
  .med-table th,
  .med-table td {
    border-bottom: 1px solid #e2e8f0;
    padding: 0.35rem 0.4rem;
    text-align: left;
  }
  .med-table th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 700;
  }
  .med-table tr[data-rec="stop"] td:nth-child(3) {
    color: #b91c1c;
  }
  .med-table tr[data-rec="taper"] td:nth-child(3) {
    color: #b45309;
  }
  .buckets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    margin: 0.55rem 0 0;
  }
  .b {
    background: #fff;
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    border: 1px solid #e2e8f0;
    font-size: 0.68rem;
  }
  .b strong {
    display: block;
    margin-bottom: 0.2rem;
  }
  .b.stop {
    border-color: #fecaca;
    background: #fef2f2;
  }
  .b.taper {
    border-color: #fde68a;
    background: #fffbeb;
  }
  .b.cont {
    border-color: #bbf7d0;
    background: #f0fdf4;
  }
  .consent-text {
    margin: 0 0 0.45rem;
    font-size: 0.72rem;
    color: #475569;
  }
  .consent-stamp {
    margin: 0;
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    border: 1px dashed #cbd5e1;
    color: #64748b;
    font-weight: 600;
    font-size: 0.72rem;
  }
  .consent-stamp.on {
    border-color: #34d399;
    background: #ecfdf5;
    color: #047857;
  }
  .sign {
    margin: 0.55rem 0 0;
    font-size: 0.72rem;
    font-weight: 700;
    text-align: right;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 0.45rem 0.65rem;
    background: #fff;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.85rem;
  }
  .secondary,
  .primary {
    border-radius: 8px;
    padding: 0.45rem 0.85rem;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    border: none;
  }
  .secondary {
    background: #f1f5f9;
    color: #475569;
  }
  .primary {
    background: #0d9488;
    color: #fff;
  }
  @media (max-width: 720px) {
    .buckets {
      grid-template-columns: 1fr;
    }
  }
</style>
