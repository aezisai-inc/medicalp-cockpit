<script lang="ts">
  import { locale, setLocale, type Locale } from "$lib/i18n/locale";

  interface Props {
    disabled?: boolean;
    onChange?: (loc: Locale) => void;
  }
  let { disabled = false, onChange }: Props = $props();

  function pick(next: Locale) {
    setLocale(next);
    onChange?.(next);
  }
</script>

<div class="locale-switch" role="group" aria-label="Language">
  <button
    type="button"
    class:active={$locale === "ja"}
    {disabled}
    onclick={() => pick("ja")}
  >
    JA
  </button>
  <button
    type="button"
    class:active={$locale === "en"}
    {disabled}
    onclick={() => pick("en")}
  >
    EN
  </button>
</div>

<style>
  .locale-switch {
    display: flex;
    gap: 0.2rem;
    padding: 0.2rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }
  button {
    border: none;
    background: transparent;
    padding: 0.4rem 0.55rem;
    border-radius: 7px;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #475569;
    cursor: pointer;
  }
  button.active {
    background: #1e3a5f;
    color: #fff;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
