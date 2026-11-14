<script lang="ts">
  import { t } from "$lib/i18n/t";

  type Med = {
    id: string;
    name: string;
    usage: string;
    recommendation: string;
    active: boolean;
  };

  interface Props {
    meds: Med[];
  }

  let { meds }: Props = $props();

  function label(rec: string): string {
    const r = (rec || "").toLowerCase();
    if (r === "stop") return $t("stopBadge");
    if (r === "taper") return $t("taperBadge");
    return $t("continueBadge");
  }
</script>

<div class="wrap" data-testid="form2-med-table">
  <h4>{$t("form2MedTableTitle")}</h4>
  <table>
    <thead>
      <tr>
        <th>{$t("form2ColName")}</th>
        <th>{$t("form2ColUsage")}</th>
        <th>{$t("form2ColRec")}</th>
        <th>{$t("form2ColContinue")}</th>
      </tr>
    </thead>
    <tbody>
      {#each meds as m (m.id)}
        <tr data-rec={m.recommendation}>
          <td>{m.name}</td>
          <td>{m.usage}</td>
          <td>{label(m.recommendation)}</td>
          <td>{m.active ? "✓" : "—"}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
    background: #fff;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  th,
  td {
    border-bottom: 1px solid #e2e8f0;
    padding: 0.4rem 0.45rem;
    text-align: left;
  }
  th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 700;
  }
  tr[data-rec="stop"] td:nth-child(3) {
    color: #b91c1c;
    font-weight: 700;
  }
  tr[data-rec="taper"] td:nth-child(3) {
    color: #c2410c;
    font-weight: 700;
  }
</style>
