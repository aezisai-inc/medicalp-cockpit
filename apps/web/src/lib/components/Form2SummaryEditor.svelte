<script lang="ts">
  import { t } from "$lib/i18n/t";

  interface Props {
    value: string;
    onChange?: (v: string) => void;
    onRegenerate?: () => void;
  }

  let { value, onChange, onRegenerate }: Props = $props();
</script>

<div class="wrap" data-testid="form2-summary-editor">
  <div class="head">
    <h4>{$t("form2SummaryTitle")}</h4>
    <button type="button" class="regen" onclick={() => onRegenerate?.()}>
      {$t("form2Regen")}
    </button>
  </div>
  <textarea
    rows="7"
    value={value}
    oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
    placeholder={$t("form2SummaryPlaceholder")}
  ></textarea>
</div>

<style>
  .wrap {
    margin-top: 0.75rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  h4 {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #64748b;
  }
  .regen {
    border: 1px solid #cbd5e1;
    background: #fff;
    border-radius: 0.4rem;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #e2e8f0;
    border-radius: 0.55rem;
    padding: 0.6rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #0f172a;
    background: #fff;
    resize: vertical;
    min-height: 7rem;
  }
</style>
