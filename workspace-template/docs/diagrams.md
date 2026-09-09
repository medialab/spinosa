---
type: architecture_diagrams
scope: repo-wide
description: Mermaid diagrams for the Spinosa orchestration framework — startup, orchestration loop, sub-agent pipeline, file layers, and lifecycle.
created: 2026-06-28
updated: 2026-06-28
---

# System Architecture Diagrams

All diagrams are Mermaid — rendered natively by GitHub.

---

## 1. High-Level Harness

```mermaid
flowchart TB
    User([User]) --> CLI[spinosa CLI\n.scan + import + convert]

    subgraph Onboarding ["Phase A: CLI Onboarding"]
        CLI --> FS[Framework-files.tsv scaffold]
        CLI --> SRC[Source scan + classify]
        SRC --> MD[Markdown-native\n.txt .csv .json .ts]
        SRC --> MKD[MarkItDown\n.docx .xlsx .html]
        SRC --> OCR[PaddleOCR Python\nscanned PDF .jpg .png]
        SRC --> SKIP[Audio/video skipped]
        MD & MKD & OCR --> RAW[raw/ corpus .md]
        CLI --> CFG[system/configuration.md\nsetup_status: cli_started]
    end

    subgraph Indexing ["Phase B: Workspace Indexing"]
        direction TB
        ORCH_0[Orchestrator\nreads startup-prompt.md] --> SURVEY[2.1 Survey corpus]
        SURVEY --> BATCH[2.2 Batch files\n20-25 per batch]
        BATCH --> PAR_MAP{2.2 Spawn ALL\nspinosa-mapper\nin parallel}
        PAR_MAP --> M1[Mapper extraction_interviews-batch-001]
        PAR_MAP --> M2[Mapper extraction_policy-pdfs-batch-002]
        PAR_MAP --> MN[Mapper extraction_{batch_id}]
        M1 & M2 & MN --> MERGE[Merge dictionary +\nextraction packets]
        MERGE --> DICT[system/dictionary.md]
        MERGE --> YAML[YAML headers on raw/]
        MERGE --> CTX[Enrich system/context.md]
        DICT --> MAPS[Phase 4 spinosa-mapper map_write]
        MAPS --> HUB[corpus_overview.md\nLevel 0 hub]
        MAPS --> GROUPS[Group maps]
        MAPS --> THEMES[Theme maps]
        MAPS --> SEREN[Phase 5 spinosa-serendippo\nNN_startup-serendipity-*.md]
        SEREN --> VAL[2.7 Validate]
        VAL --> VER[spinosa-verifier\nclaim check]
        VER --> EVAL[spinosa-evaluator\nroute audit]
        EVAL --> DONE[system/configuration.md\nsetup_status: workspace_started]
    end

    RAW --> ORCH_0
```

---

## 2. Orchestrator Loop

```mermaid
flowchart LR
    PROMPT([User prompt]) --> LOG[1. Log\nRead orchestrator-notes.md]
    LOG --> SPLIT[2. Route split]

    SPLIT --> FAST[fast_path\nDirect answer]
    SPLIT --> NON[non-fast-path\nOrchestrate agents]

    NON --> FRAME[3. Frame goal artifact\nagent_reports/g_N.md]

    FRAME --> LOOP_START{4. Execute → Inspect → Decide}

    LOOP_START --> DISPATCH[4a. Dispatch sub-agent\nwith goal + prior artifact paths]
    DISPATCH --> EXECUTE[Agent runs\nwrites artifact]
    EXECUTE --> INSPECT{4b. Inspect\nDoes output\nclear gate?}
    INSPECT -->|Passes| PROGRESS{Progress\nexpected?}
    INSPECT -->|Fixable gap| DISPATCH
    INSPECT -->|Wrong direction| REROUT[Re-route\ndifferent agent]
    INSPECT -->|Blocker| ABORT[Abort route]

    PROGRESS -->|Chain complete| CLOSE
    PROGRESS -->|More agents| LOOP_START

    REROUT --> DISPATCH
    ABORT --> DELIVER[5d. Deliver]

    subgraph CLOSE [5. Close]
        direction TB
        V[5a. spinosa-verifier\nfactual gate] --> E[5b. spinosa-evaluator\nprocess gate]
        E --> EVOL{5c. Evaluator says\nedit_recommended?}
        EVOL -->|Yes| EVOLVER[spinosa-evolver\napply framework fix]
        EVOL -->|No| DEL
        EVOLVER --> DEL
    end

    CLOSE --> NOTES[Update orchestrator-notes.md]
    DELIVER --> NOTES
    NOTES --> DONE_DELIVER(Report done / blocked / partial)

    FAST --> ANS[Answer user directly]
```

---

## 3. Sub-Agent Pipeline

```mermaid
flowchart TB
    subgraph Evidence ["Evidence Layer"]
        RAW[(raw/\ncorpus)]
        MAPS[(maps/\nnavigation)]
        DICT[(system/dictionary.md)]
    end

    subgraph Agents ["Agent Pipeline"]
        SEARCH[spinosa-searcher\nEvidence retrieval]
        ANALYST[spinosa-analyst\nContextual analysis]
        SEREN2[spinosa-serendippo\nHidden connections]
        WRITER[spinosa-writer\nReport synthesis]
        VERIFIER[spinosa-verifier\nClaim verification]
        EVALUATOR[spinosa-evaluator\nRoute audit]
        EVOLVER[spinosa-evolver\nFramework edits]
        JANITOR[spinosa-janitor\nHygiene audit]
        MAPPER[spinosa-mapper\nStartup indexing]
        OVERSEER[spinosa-overseer\nCoverage audit]
    end

    RAW --> SEARCH
    MAPS --> SEARCH
    MAPS --> SEREN2
    RAW --> SEREN2
    DICT --> ANALYST
    SEARCH & ANALYST & SEREN2 --> WRITER
    WRITER --> VERIFIER
    VERIFIER --> |Terminal artifact| EVALUATOR
    EVALUATOR --> |edit_recommended| EVOLVER
    JANITOR --> |cleanup proposal| RAW
    RAW --> MAPPER
    MAPPER --> MAPS
    MAPPER --> DICT
    OVERSEER --> MAPS
    OVERSEER --> DICT
    OVERSEER --> |Orchestrator Advisories| ORCH[Orchestrator]
```

---

## 4. File Layer Architecture

```mermaid
flowchart TB
    subgraph Framework ["Framework (template files)"]
        AGENTS[AGENTS.md\nOrchestrator contract]
        STARTUP[startup-prompt.md\nIndexing protocol]
        CLI_BIN[.bin/spinosa\nCLI entry point]
        SRC[.bin/lib/spinosa/\nShell CLI library]
        DEF[.agents/agents/\n10 agent definitions]
        MIRRORS[.opencode/ .claude/ .codex/\nvendor agent + skill mirrors]
        HERMES[.hermes/\nskills + references mirror]
        REF[.agents/references/\ntemplates + classification]
        FILES[workspace-template/.spinosa/workspace-files.tsv\nfile manifest]
    end

    subgraph UserState ["User state (per workspace)"]
        RAW2[(raw/\ncorpus copies)]
        MAPS2[(maps/\nnavigation)]
        SYS[system/\nconfig + context +
        dictionary + index]
        REPORTS[agent_reports/\ngoal artifacts +
        evidence + reports]
        MEMORY[.spinosa/memory/\norchestrator-notes.md]
        TRASH[.trash/\narchived intermediates]
    end

    subgraph Logs ["Historical archive"]
        LOGS[.logs/\nimport traces]
    end

    FRAMEWORK_MANIFEST -.->|scaffold| UserState
    DEF -.->|dispatch| REPORTS
    HERMES -.->|fallback skills| ORCH[Orchestrator]
    AGENTS -.->|governs| ORCH
```

---

## 5. Chain Shapes

```mermaid
flowchart LR
    subgraph Q1 ["Evidence-grounded answer"]
        A1[Goal] --> B1[Searcher]
        B1 --> C1[Writer]
        C1 --> D1[Verifier]
        D1 --> E1[Evaluator]
    end

    subgraph Q2 ["Answer with broader context"]
        A2[Goal] --> B2[Searcher]
        B2 --> C2[Analyst]
        C2 --> D2[Writer]
        D2 --> E2[Verifier]
        E2 --> F2[Evaluator]
    end

    subgraph Q3 ["Hidden connections"]
        A3[Goal] --> B3[Searcher]
        B3 --> C3a[Analyst]
        C3a --> C3[Serendippo]
        C3 --> D3[Writer]
        D3 --> E3[Verifier]
        E3 --> F3[Evaluator]
    end

    subgraph Q4 ["Cleanup audit"]
        A4[Goal] --> B4[Janitor]
        B4 --> C4[Verifier]
        C4 --> D4[Evaluator]
    end

    subgraph Q5 ["Periodic coverage"]
        A5[Goal] --> B5[Overseer]
        B5 --> C5[Evaluator]
    end
```

---

## 6. Configuration State Machine

```mermaid
stateDiagram-v2
    [*] --> not_started
    not_started --> cli_started: spinosa new\n(Onboarding complete)
    cli_started --> workspace_started: Startup indexing\n(All validation gates pass)
    cli_started --> cli_started: Recovery resume\n(Resume from last phase)
    workspace_started --> [*]
```

---

## 7. File Classification Pipeline

```mermaid
flowchart LR
    SRC[Source file] --> CLASS{Classify}
    CLASS -->|.md| NATIVE[Native markdown\ncopy + YAML header]
    CLASS -->|.txt .csv .json .ts .py .yaml| MD_CONV[Markdown-convertible\nrenamed to .md]
    CLASS -->|.docx .xlsx .html .epub| MKD2[MarkItDown\n→ .md]
    CLASS -->|scanned PDF .jpg .png| OCR2[PaddleOCR Python\n→ .md]
    CLASS -->|.mp4 .mov .mp3 .wav| SKIP2[Skipped\nby default]
    CLASS -->|.DS_Store ._*| IGNORE[Ignored]

    NATIVE & MD_CONV & MKD2 & OCR2 --> RAW3[raw/ .md]
```

---

## 8. Orchestrator Notepad Data Flow

```mermaid
flowchart LR
    subgraph Session ["Per session"]
        START[Start: read notepad] --> DISP[Sub-agent dispatch]
        DISP --> CLOSE2[Close: update notepad]
    end

    subgraph Persistence ["Cross-session"]
        NOTES2[(.spinosa/memory/\norchestrator-notes.md)]
    end

    START --> NOTES2
    CLOSE2 --> NOTES2
    OVERSEER2[spinosa-overseer\ncoverage audit] --> NOTES2
```

---

## 9. Sub-Agent Gateway

```mermaid
flowchart TB
    ORCH2[Orchestrator] --> TRY{Try native spawn}

    TRY -->|Available| NATIVE_SPAWN[Native sub-agent\ntool dispatch]
    NATIVE_SPAWN --> ARTIFACT[Writes artifact\nagent_reports/*_{session_id}.md\nor NN_*.md]
    ARTIFACT --> GATE{Evaluate gate}

    TRY -->|Unavailable| TASK[Task-tool spawn\nCursor / Grok]
    TASK --> INJECT2[Inject .agents/agents/name.md\nas Task prompt]
    INJECT2 --> ARTIFACT

    TRY -->|Hermes host| HERMES_D[delegate_task or\n/spinosa-agent skill]
    HERMES_D --> ARTIFACT

    TRY -->|Fails| FALLBACK[Read fallback\n.agents/agents/name.md\nor .hermes/skills/*/SKILL.md]
    FALLBACK --> INJECT[Inject instruction body]
    INJECT --> FALLBACK_SPAWN[Sub-agent via\nvendor tool]
    FALLBACK_SPAWN --> ARTIFACT

    GATE -->|Pass| LOG[Append Route Decision\nto g_{session_id}.md]
    LOG --> DONE2(Done)
    GATE -->|Fail, fixable| RETRY[Retry same agent\nmax 2 times]
    GATE -->|Fail, direction| REROUT2[Re-route]
    GATE -->|Timeout| RETRY_TIGHT[Retry tightened scope\nor abort]

    RETRY --> TRY
    REROUT2 --> TRY
    RETRY_TIGHT --> TRY
```
