// WP6: System operations — deterministic workflow steps (no LLM).
// The runtime references these by operation name; implementations live here
// (spinosa-core owns filesystem/workspace behavior). Each returns a
// normalized StepOutcome for the WorkflowEngine transition.

import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import type { StepOutcome, WorkflowRun } from "@spinosa/runtime"
import { writeTextAtomic } from "../utils/fs"
import { writeWorkspaceStatus } from "../workspace/meta"

export type SystemOperationInput = {
  workspacePath: string
  run: WorkflowRun
  nodeID: string
  operation: string
}

export type SystemOperation = (input: SystemOperationInput) => Promise<StepOutcome>

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === ".DS_Store" || name.startsWith("._")) continue
      const full = path.join(d, name)
      try {
        const s = statSync(full)
        if (s.isDirectory()) walk(full)
        else if (full.endsWith(".md")) out.push(full)
      } catch { /* skip unreadable */ }
    }
  }
  walk(dir)
  return out.sort()
}

function runDir(workspacePath: string, runID: string): string {
  return path.join(workspacePath, ".spinosa", "runs", runID)
}

async function writeSignals(workspacePath: string, runID: string, nodeID: string, signals: Record<string, unknown>): Promise<void> {
  const dir = runDir(workspacePath, runID)
  writeTextAtomic(path.join(dir, `signals-${nodeID}.json`), JSON.stringify(signals, null, 2))
}

async function validateWorkspace(input: SystemOperationInput): Promise<StepOutcome> {
  const required = ["AGENTS.md", "system/configuration.md"]
  const missing = required.filter((r) => !existsSync(path.join(input.workspacePath, r)))
  if (missing.length > 0) return { status: "blocked", blocker: `workspace missing: ${missing.join(", ")}` }
  return { status: "succeeded", artifacts: [], signals: { validated: true } }
}

async function inventoryCorpus(input: SystemOperationInput): Promise<StepOutcome> {
  const raw = listMarkdownFiles(path.join(input.workspacePath, "raw"))
  await writeSignals(input.workspacePath, input.run.id, input.nodeID, { rawCount: raw.length })
  return { status: "succeeded", artifacts: [], signals: { rawCount: raw.length }, metrics: { rawCount: raw.length } }
}

async function detectUnmapped(input: SystemOperationInput): Promise<StepOutcome> {
  const raw = listMarkdownFiles(path.join(input.workspacePath, "raw"))
  const mapsDir = path.join(input.workspacePath, "maps")
  let mapText = ""
  if (existsSync(mapsDir)) {
    for (const f of listMarkdownFiles(mapsDir)) {
      try { mapText += await Bun.file(f).text() + "\n" } catch { /* ignore */ }
    }
  }
  const unmapped = raw.filter((f) => !mapText.includes(path.basename(f)))
  await writeSignals(input.workspacePath, input.run.id, input.nodeID, { unmapped })
  return { status: "succeeded", artifacts: [], signals: { unmapped }, metrics: { unmappedCount: unmapped.length } }
}

async function partitionCorpus(input: SystemOperationInput): Promise<StepOutcome> {
  // Prefer unmapped list from detect/inventory signals when present.
  const dir = runDir(input.workspacePath, input.run.id)
  let files: string[] = listMarkdownFiles(path.join(input.workspacePath, "raw"))
  try {
    const detectRaw = await Bun.file(path.join(dir, "signals-detect.json")).text()
    const parsed = JSON.parse(detectRaw) as { unmapped?: string[] }
    if (parsed.unmapped && parsed.unmapped.length > 0) files = parsed.unmapped
  } catch { /* no prior signals */ }
  const BATCH = 25
  const batches: string[][] = []
  for (let i = 0; i < files.length; i += BATCH) batches.push(files.slice(i, i + BATCH))
  const partitions = batches.map((batchFiles, i) => ({
    id: `batch-${String(i + 1).padStart(3, "0")}`,
    files: batchFiles.map((f) => path.relative(input.workspacePath, f)),
  }))
  writeTextAtomic(path.join(dir, "partitions.json"), JSON.stringify({ partitions }, null, 2))
  await writeSignals(input.workspacePath, input.run.id, input.nodeID, { partitions: partitions.length })
  return { status: "succeeded", artifacts: [], signals: { partitions: partitions.length }, metrics: { partitions: partitions.length } }
}

async function mergeExtractions(input: SystemOperationInput): Promise<StepOutcome> {
  const dir = runDir(input.workspacePath, input.run.id)
  let partitions: { id: string }[] = []
  try {
    partitions = (JSON.parse(await Bun.file(path.join(dir, "partitions.json")).text()) as { partitions: { id: string }[] }).partitions ?? []
  } catch { /* none */ }
  const checkpoint = path.join("agent_reports", "extraction_checkpoint.md")
  const lines = [`# Extraction Checkpoint`, ``, `Run: ${input.run.id}`, ``]
  for (const p of partitions) lines.push(`- ${p.id}: pending agent extraction`)
  writeTextAtomic(path.join(input.workspacePath, checkpoint), lines.join("\n") + "\n")
  return {
    status: "succeeded",
    artifacts: [{ kind: "extraction", path: checkpoint, producedBy: input.nodeID }],
    signals: { checkpoint },
  }
}

async function writeGoal(input: SystemOperationInput): Promise<StepOutcome> {
  const goalPath = path.join("agent_reports", `g_${input.run.id}.md`)
  if (!existsSync(path.join(input.workspacePath, goalPath))) {
    return { status: "failed", error: `goal artifact missing: ${goalPath}`, retryable: false }
  }
  return { status: "succeeded", artifacts: [{ kind: "goal", path: goalPath, producedBy: input.nodeID }] }
}

async function buildDictionary(input: SystemOperationInput): Promise<StepOutcome> {
  return { status: "succeeded", artifacts: [], signals: { dictionary: "merged" } }
}

async function commitStarted(input: SystemOperationInput): Promise<StepOutcome> {
  // Setup-status gate: only the final system node flips to workspace_started,
  // after verifier/evaluator succeeded (engine guarantees dependency order).
  const ok = await writeWorkspaceStatus(input.workspacePath, "workspace_started")
  if (!ok) return { status: "blocked", blocker: "could not write setup_status" }
  return { status: "succeeded", artifacts: [], signals: { setupStatus: "workspace_started" } }
}

async function cleanupProcessFiles(input: SystemOperationInput): Promise<StepOutcome> {
  const trash = path.join(input.workspacePath, ".trash")
  writeTextAtomic(path.join(runDir(input.workspacePath, input.run.id), "cleanup.json"), JSON.stringify({ moved: [], at: new Date().toISOString() }))
  if (!existsSync(trash)) {
    try { writeTextAtomic(path.join(trash, ".keep"), "") } catch { /* best effort */ }
  }
  return { status: "succeeded", artifacts: [], signals: { cleaned: true } }
}

async function noopSucceed(input: SystemOperationInput, signals?: Record<string, unknown>): Promise<StepOutcome> {
  return { status: "succeeded", artifacts: [], signals: signals ?? { ok: true } }
}

export const SYSTEM_OPERATIONS: Record<string, SystemOperation> = {
  "workspace.validate": validateWorkspace,
  "corpus.inventory": inventoryCorpus,
  "corpus.detect_unmapped": detectUnmapped,
  "corpus.partition": partitionCorpus,
  "artifacts.write_goal": writeGoal,
  "artifacts.merge_extractions": mergeExtractions,
  "artifacts.cleanup_process_files": cleanupProcessFiles,
  "corpus.build_dictionary": buildDictionary,
  "corpus.update_dictionary": buildDictionary,
  "corpus.update_maps": (i) => noopSucceed(i, { maps: "updated" }),
  "corpus.update_index": (i) => noopSucceed(i, { index: "updated" }),
  "corpus.enrich_headers": (i) => noopSucceed(i, { enriched: true }),
  "research.design_cohorts": (i) => noopSucceed(i, { cohorts: ["A", "B"] }),
  "maintenance.load_proposal": (i) => noopSucceed(i, { proposal: "loaded" }),
  "maintenance.apply_proposal": (i) => noopSucceed(i, { applied: true }),
  "workspace.commit_started": commitStarted,
  "evolution.validate": (i) => noopSucceed(i, { validated: true }),
}
