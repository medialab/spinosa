import path from "node:path"
import type { SpinosaCliIo } from "../io"
import { emitResult } from "../io"
import {
  readWorkspaceMeta,
  isSpinosaWorkspace,
  getFrameworkHealth,
  readFrameworkVersionFromRoot,
  resolveFrameworkRoot,
  detectDocumentTools,
} from "@spinosa/core"

export async function runStatus(workspacePath: string | undefined, io: SpinosaCliIo): Promise<number> {
  const frameworkRoot = resolveFrameworkRoot()
  const frameworkVersion = readFrameworkVersionFromRoot(frameworkRoot)
  const tools = await detectDocumentTools()

  const resolvedWorkspace = workspacePath ? path.resolve(workspacePath) : process.cwd()
  const isWorkspace = isSpinosaWorkspace(resolvedWorkspace)
  let meta = undefined
  if (isWorkspace) {
    meta = await readWorkspaceMeta(resolvedWorkspace)
  }

  let allOk = Boolean(frameworkRoot)
  const checks: string[] = []
  if (!frameworkRoot) checks.push("Framework: not found")
  else checks.push(`Framework: ok`)

  for (const [name, available] of Object.entries(tools)) {
    // Local OCR was removed: ocr:false + ocrUnsupportedReason are the
    // contract, not a health failure. Report without failing status.
    if (name === "ocr" || name === "ocrUnsupportedReason") {
      checks.push(name === "ocr" ? `${name}: unavailable (removed)` : `${name}: ok`)
      continue
    }
    if (!available) { allOk = false; checks.push(`${name}: missing`) }
    else checks.push(`${name}: ok`)
  }

  if (workspacePath && !isWorkspace) {
    allOk = false
    checks.push(`Workspace: invalid (${resolvedWorkspace})`)
  }

  if (meta) {
    checks.push(`Workspace: ${resolvedWorkspace}`)
    checks.push(`Status: ${meta.setupStatus}`)
    checks.push(`Version: ${meta.frameworkVersion ?? "unknown"}`)
    for (const check of getFrameworkHealth(resolvedWorkspace)) {
      if (!check.ok) allOk = false
      checks.push(`${check.ok ? "ok" : "missing"}: ${check.label}`)
    }
  }

  if (io.format === "human") {
    io.out(`Spinosa ${frameworkVersion || "dev"}`)
    for (const c of checks) io.out(`  ${c}`)
  }

  emitResult(io, "status", {
    healthy: allOk,
    frameworkVersion,
    frameworkRoot,
    workspace: meta ? {
      path: resolvedWorkspace,
      status: meta.setupStatus,
      version: meta.frameworkVersion,
    } : null,
    tools,
  }, allOk ? "healthy" : "issues found")

  return allOk ? 0 : 1
}
