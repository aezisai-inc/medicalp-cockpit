<script lang="ts">
  import { t } from "$lib/i18n/t";

  type Item = { title: string; detail: string; url?: string };

  interface Props {
    items: Item[];
  }

  let { items }: Props = $props();
</script>

<section class="wrap" data-testid="improvement-forecast">
  <h4>{$t("improveTitle")}</h4>
  {#if items.length}
    <ul>
      {#each items as it, i (i)}
        <li>
          <strong>{it.title}</strong>
          <p>{it.detail}</p>
          {#if it.url}
            <a href={it.url} target="_blank" rel="noreferrer">{$t("improveSource")}</a>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{$t("improveEmpty")}</p>
  {/if}
</section>

<style>
  .wrap {
    margin-top: 0.75rem;
  }
  h4 {
    margin: 0 0 0.4rem;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #64748b;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  li {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.55rem 0.65rem;
  }
  strong {
    font-size: 0.78rem;
    color: #0f172a;
  }
  p {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    color: #475569;
    line-height: 1.4;
  }
  a {
    display: inline-block;
    margin-top: 0.3rem;
    font-size: 0.68rem;
    color: #0369a1;
  }
  .empty {
    margin: 0;
    font-size: 0.75rem;
    color: #94a3b8;
  }
</style>
