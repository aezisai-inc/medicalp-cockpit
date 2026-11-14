<script lang="ts">
  import { t } from "$lib/i18n/t";

  interface Props {
    busy?: boolean;
    status?: string;
    onScan: (file?: File) => void;
  }

  let { busy = false, status = "", onScan }: Props = $props();
  const shown = $derived(status || $t("scanIdle"));
  let dragging = $state(false);
  let scanFileInput = $state<HTMLInputElement | null>(null);

  function openPicker() {
    if (busy) return;
    scanFileInput?.click();
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    // Allow re-selecting the same file after clear / prior pick.
    input.value = "";
    if (!busy && f) onScan(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (busy) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) onScan(f);
  }
</script>

<div
  class="scan-bar"
  class:dragging
  data-testid="scan-dropzone"
  role="group"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => {
    dragging = false;
  }}
  ondrop={onDrop}
>
  <input
    bind:this={scanFileInput}
    type="file"
    accept="image/*"
    class="sr-only"
    style="display: none"
    aria-hidden="true"
    tabindex="-1"
    disabled={busy}
    data-testid="scan-file-input"
    onchange={onFileChange}
  />
  <div class="scan-btn-wrap">
    <button type="button" class="scan-btn" disabled={busy} onclick={openPicker}>
      {$t("scanBtn")}
    </button>
  </div>
  <span class="scan-drop-hint">{$t("scanDrop")}</span>
  <span class="status">{shown}</span>
</div>

<style>
  .scan-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
    padding: 0.45rem 0.55rem;
    border-radius: 10px;
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    transition: border-color 0.15s, background 0.15s;
  }
  .scan-bar.dragging {
    border-color: #4f46e5;
    background: #eef2ff;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .scan-btn-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .scan-btn {
    background: #4f46e5;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 0.45rem 0.75rem;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(79, 70, 229, 0.35);
  }
  .scan-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .scan-drop-hint {
    font-size: 0.82rem;
    font-weight: 400;
    color: #64748b;
    cursor: default;
    flex: 1;
    min-width: 10rem;
  }
  .status {
    font-size: 0.62rem;
    font-family: ui-monospace, monospace;
    color: #64748b;
    flex: 1;
    min-width: 8rem;
  }
</style>
