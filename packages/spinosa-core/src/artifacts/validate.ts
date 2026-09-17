// WP3: Artifact validators — filesystem truth, not conversational claims.
// Each validator checks expected path containment (no escape from workspace),
// frontmatter, and kind-specific gates. Returns retryable=false for
// structural violations the agent cannot fix by rerunning (e.g. blocked).

import path from "node:path"
import type { ArtifactValidatorID, ValidationResult } from "./contracts"
import { parseVerificationStatus } from "./contracts"
import { parseYamlFrontmatter } from "./parser"

function contained(workspacePath: string, relative: string): boolean {
  const resolved = path.resolve(workspacePath, relative)
  return resolved === path.resolve(workspacePath) || resolved.startsWith(path.resolve(workspacePath) + path.sep)
}

async function readIfExists(absolute: string): Promise<string | undefined> {
  const f = Bun.file(absolute)
  if (!(await f.exists())) return undefined
  return f.text()
}

export async function validateArtifact(input: {
  workspacePath: string
  relativePath: string
  validator: ArtifactValidatorID | string
  runID?: string
}): Promise<ValidationResult> {
  const { workspacePath, relativePath, validator, runID } = input
  if (!contained(workspacePath, relativePath)) {
    return { ok: false, error: `artifact path escapes workspace: ${relativePath}`, retryable: false }
  }
  const absolute = path.join(workspacePath, relativePath)
  const text = await readIfExists(absolute)
  if (text === undefined) {
    return { ok: false, error: `missing artifact: ${relativePath}`, retryable: true }
  }
  if (!text.trim()) {
    return { ok: false, error: `empty artifact: ${relativePath}`, retryable: true }
  }
  const yaml = parseYamlFrontmatter(text)
  switch (validator) {
    case "goal": {
      if (runID && yaml.run_id && yaml.run_id !== runID) {
        return { ok: false, error: `goal run_id mismatch`, retryable: false }
      }
      if (!/Research Objective|Goal Statement/.test(text)) {
        return { ok: false, error: "goal artifact missing objective", retryable: true }
      }
      return { ok: true }
    }
    case "evidence_packet": {
      const hasSources = /source[_ -]?paths?|quotes?|evidence/i.test(text)
      const count = (text.match(/^-\s+.+/gm) ?? []).length
      if (!hasSources && count < 1) return { ok: false, error: "evidence packet has no sources", retryable: true }
      return { ok: true }
    }
    case "analysis": {
      if (runID && !text.includes(runID) && !yaml.run_id && !yaml.session_id) {
        return { ok: false, error: "analysis missing run linkage", retryable: true }
      }
      return { ok: true }
    }
    case "serendipity": {
      return { ok: true }
    }
    case "visualization": {
      if (!/chart|plot|graph|```/.test(text)) return { ok: false, error: "visualization has no chart", retryable: true }
      return { ok: true }
    }
    case "report": {
      const title = text.match(/^#\s+.+/m)
      if (!title) return { ok: false, error: "report missing title", retryable: true }
      return { ok: true }
    }
    case "verification": {
      const status = parseVerificationStatus(text)
      if (!status) return { ok: false, error: "verification missing status (pass|pass_with_corrections|partial|fail|blocked)", retryable: true }
      return { ok: true }
    }
    case "evaluation": {
      return { ok: true }
    }
    case "extraction": {
      if (!/batch_id|batch id|files? processed|processed/i.test(text)) {
        return { ok: false, error: "extraction missing batch metadata", retryable: true }
      }
      return { ok: true }
    }
    case "maps": {
      if (!/\[\[.+\]\]/.test(text)) return { ok: false, error: "map missing wikilinks", retryable: true }
      return { ok: true }
    }
    case "coverage": {
      return { ok: true }
    }
    case "cleanup": {
      if (!/proposal|approved|actions?/i.test(text)) return { ok: false, error: "cleanup artifact missing proposal state", retryable: true }
      return { ok: true }
    }
    default:
      return { ok: true }
  }
}

/** Evidence sufficiency gate by coverage contract. */
export function evidenceGate(input: {
  coverage: "opportunistic" | "sufficient" | "representative" | "exhaustive"
  sourceCount: number
  strataCovered: number
  strataTotal: number
  partitionsAccounted: number
  partitionsTotal: number
}): { pass: boolean; reason: string } {
  switch (input.coverage) {
    case "opportunistic":
      return input.sourceCount >= 1
        ? { pass: true, reason: "opportunistic: ≥1 source" }
        : { pass: false, reason: "opportunistic needs ≥1 source" }
    case "sufficient":
      return input.sourceCount >= 1
        ? { pass: true, reason: "sufficient: bounded claim supported or documented no-evidence" }
        : { pass: false, reason: "sufficient needs support or documented no-evidence" }
    case "representative":
      return input.strataTotal === 0 || input.strataCovered >= input.strataTotal
        ? { pass: true, reason: "representative: every stratum covered" }
        : { pass: false, reason: `representative needs all strata (${input.strataCovered}/${input.strataTotal})` }
    case "exhaustive":
      return input.partitionsTotal === 0 || input.partitionsAccounted >= input.partitionsTotal
        ? { pass: true, reason: "exhaustive: every partition accounted" }
        : { pass: false, reason: `exhaustive needs all partitions (${input.partitionsAccounted}/${input.partitionsTotal})` }
  }
}

/** Verification outcome → engine action. partial retries when possible. */
export function verificationOutcome(status: string): "complete" | "retry" | "block" {
  const s = status.toLowerCase()
  if (s === "pass" || s === "pass_with_corrections") return "complete"
  if (s === "partial") return "retry"
  return "block" // fail | blocked
}
