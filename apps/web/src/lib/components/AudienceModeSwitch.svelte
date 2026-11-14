<script lang="ts">
  import { t } from "$lib/i18n/t";

  type Mode = "clinician" | "family";

  interface Props {
    mode: Mode;
    disabled?: boolean;
    onSwitch: (mode: Mode) => void;
  }

  let { mode, disabled = false, onSwitch }: Props = $props();
</script>

<div class="mode-switch" role="group" aria-label="Audience mode">
  <button
    type="button"
    class:active={mode === "clinician"}
    {disabled}
    onclick={() => onSwitch("clinician")}
  >
    {$t("modeClinician")}
  </button>
  <button
    type="button"
    class:active={mode === "family"}
    {disabled}
    onclick={() => onSwitch("family")}
  >
    {$t("modeFamily")}
  </button>
</div>

<style>
  .mode-switch {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  }
  button {
    border: none;
    background: transparent;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    font-size: 0.72rem;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
  }
  button.active {
    background: #0f172a;
    color: #fff;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
