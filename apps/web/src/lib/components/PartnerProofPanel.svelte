<script lang="ts">
  import PartnerServiceBadge, {
    type PartnerSource,
  } from "./PartnerServiceBadge.svelte";

  let {
    codeafHint = "",
    codeafSource = "idle",
    familyRewriteApplied = false,
    daytonaSource = "idle",
    sandboxId = "",
    destroyProof = "",
    fallBefore,
    fallAfter,
  }: {
    codeafHint?: string;
    codeafSource?: PartnerSource;
    familyRewriteApplied?: boolean;
    daytonaSource?: PartnerSource;
    sandboxId?: string;
    destroyProof?: string;
    fallBefore?: number;
    fallAfter?: number;
  } = $props();

  const uuid = $derived(
    sandboxId ||
      (destroyProof.startsWith("destroyed:")
        ? destroyProof.replace("destroyed:", "")
        : ""),
  );
</script>

<section class="proof" data-testid="partner-proof-panel" aria-label="Partner proof">
  <h3 class="title">Partner Proof</h3>
  <div class="grid">
    <article class="card" data-testid="proof-codeaf">
      <header>
        <PartnerServiceBadge name="CodeAF" source={codeafSource} />
        {#if familyRewriteApplied}
          <span class="tag">Rewritten by CodeAF</span>
        {/if}
      </header>
      <p class="label">Sandbox hint</p>
      <blockquote class="hint">{codeafHint || "—"}</blockquote>
    </article>
    <article class="card" data-testid="proof-daytona">
      <header>
        <PartnerServiceBadge name="Daytona" source={daytonaSource} />
      </header>
      <ol class="life">
        <li class:on={Boolean(uuid)}>Created</li>
        <li class:on={Boolean(uuid)}>codeRun</li>
        <li class:on={Boolean(uuid)}>Destroyed</li>
      </ol>
      <p class="uuid" title={uuid}>{uuid || "sandbox pending"}</p>
      {#if fallBefore != null && fallAfter != null}
        <p class="metrics">
          Fall risk {fallBefore}→{fallAfter} · computed in sandbox
        </p>
      {/if}
    </article>
  </div>
</section>

<style>
  .proof {
    margin: 0.75rem 0 1rem;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(255, 255, 255, 0.72);
  }
  .title {
    margin: 0 0 0.55rem;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #475569;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .card {
    padding: 0.55rem 0.65rem;
    border-radius: 10px;
    background: #f8fafc;
    border: 1px solid rgba(226, 232, 240, 0.9);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-bottom: 0.35rem;
  }
  .tag {
    font-size: 0.62rem;
    font-weight: 700;
    color: #0369a1;
    background: #e0f2fe;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
  }
  .label {
    margin: 0;
    font-size: 0.65rem;
    color: #64748b;
  }
  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    line-height: 1.35;
    color: #0f172a;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .life {
    list-style: none;
    display: flex;
    gap: 0.35rem;
    padding: 0;
    margin: 0 0 0.35rem;
    flex-wrap: wrap;
  }
  .life li {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 0.15rem 0.4rem;
    border-radius: 6px;
    background: #e2e8f0;
    color: #64748b;
  }
  .life li.on {
    background: #d1fae5;
    color: #065f46;
  }
  .uuid {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.65rem;
    word-break: break-all;
    color: #334155;
  }
  .metrics {
    margin: 0.35rem 0 0;
    font-size: 0.68rem;
    color: #0f766e;
    font-weight: 600;
  }
</style>
