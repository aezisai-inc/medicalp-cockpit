# CodeAF Pharmacist Harness + Daytona Proof of Execution

report_kind: design
stream: 1118-codeaf-pharmacist-harness
plan_review_status: PASS
INDEX_FALLBACK: true
index_paths_read: .cortex-hippocampus/experience/rules/INDEX.md

## 判定

As-Is の並列 1-shot は LIVE 証跡デモには足りるが CodeAF スポンサー審査は弱い。To-Be では CodeAF を薬剤師 KB ハーネス（Control Plane）、Daytona を決定論的サンドボックス（Data Plane）とし、codeAfSpec 注入で metrics を実際に変動させ digest / appliedKbRules / destroyProof で動作立証する。

## Class

```mermaid
classDiagram
    direction TB
    class CareAuditOrchestrator {
      +phaseA_PlanAndEvidence()
      +phaseB_SimAndReport()
    }
    class CodeAF_PharmacistHarness {
      +generateSandboxHint()
      +rewriteFamilyCopy()
    }
    class PharmacistKB {
      +KB1_interactions
      +KB2_pkTemplates
      +KB3_familyEthics
    }
    class DaytonaSandbox {
      +runDeprescribeSim(meds codeAfSpec)
      +codeAfHintDigest
      +appliedKbRules
      +destroyProof
    }
    class TavilyEvidence
    class NosanaVision
    class NosanaLlm
    CareAuditOrchestrator --> NosanaVision
    CareAuditOrchestrator --> CodeAF_PharmacistHarness
    CodeAF_PharmacistHarness --> PharmacistKB
    CareAuditOrchestrator --> TavilyEvidence
    CareAuditOrchestrator --> DaytonaSandbox
    CareAuditOrchestrator --> NosanaLlm
```

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Orch as CareAuditOrchestrator
    participant CodeAF as CodeAF_Harness
    participant KB as PharmacistKB
    participant Tavily as Tavily
    participant Daytona as Daytona
    participant Py as PythonSim
    User->>Orch: audit run
    Orch->>CodeAF: PhaseA plan
    CodeAF->>KB: load rules
    CodeAF-->>Orch: codeAfSpec digest
    Orch->>Tavily: searchQuery from harness
    Orch->>Daytona: PhaseB create sandbox
    Daytona->>Py: codeRun _meds _codeaf_spec
    Py-->>Daytona: metrics appliedKbRules
    Daytona-->>Orch: destroyProof digest
    Note over Orch: SSE via CodeAF KB spec
    Orch-->>User: partners LIVE CACHE FIXTURE
```

## Activity

```mermaid
flowchart TD
    startNode([Audit start]) --> vision[Nosana Vision]
    vision --> plan[CodeAF load KB and plan]
    plan --> tavily[Tavily harness query]
    tavily --> inject[Inject codeAfSpec into Daytona]
    inject --> sim[Sandbox Python evaluate taper ACB]
    sim --> prove[Return digest rules destroyProof]
    prove --> report[Nosana draft plus CodeAF family]
    report --> doneNode([SSE final])
```

## Daytona x CodeAF 境界立証

- Control Plane: CodeAF + Pharmacist KB が構造化 codeAfSpec を生成。
- Data Plane: Daytona が _codeaf_spec を Python に json.loads 注入し計算。LLM 暗算禁止。
- 立証: 同一 meds で taper 変更 → metrics 変化 + codeAfHintDigest 一致 + SSE via CodeAF KB spec。
- 53MB CodeAF バイナリは持ち込まない。
