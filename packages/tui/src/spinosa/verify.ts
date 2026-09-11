import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MAIN_CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from "../util/layout"
import { resolveFrameworkBin, resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import { routeForSetupStatus } from "./entry"
import {
  getCorpusSummary,
  getRoutesSnapshot,
} from "./service"
import {
  getFrameworkHealth,
  isSpinosaWorkspace,
  readWorkspaceMeta,
} from "@spinosa/core/workspace/meta"

export type VerifyCheck = {
  id: string
  ok: boolean
  detail: string
  optional?: boolean
}

export type VerifyReport = {
  checks: VerifyCheck[]
  passed: number
  failed: number
}

export function fixtureWorkspacePath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/spinosa/fixtures/workspace-started")
}

export async function runSpinosaMaturityChecks(fixturePath = fixtureWorkspacePath()): Promise<VerifyReport> {
  const checks: VerifyCheck[] = []

  const push = (id: string, ok: boolean, detail: string, optional = false) => {
    checks.push({ id, ok, detail, optional })
  }

  push("layout.main_max_width", MAIN_CONTENT_MAX_WIDTH === 100, `MAIN_CONTENT_MAX_WIDTH=${MAIN_CONTENT_MAX_WIDTH}`)
  push("layout.sidebar_width", SIDEBAR_WIDTH === 42, `SIDEBAR_WIDTH=${SIDEBAR_WIDTH}`)

  const framework = resolveFrameworkRoot()
  push(
    "framework.root",
    Boolean(framework),
    framework ?? "missing — run scripts/link-framework.sh from repo root",
    true,
  )

  const bin = resolveFrameworkBin()
  push("framework.bin", Boolean(bin), bin ?? "spinosa CLI not found", true)

  push("fixture.exists", existsSync(fixturePath), fixturePath)
  push("fixture.is_workspace", isSpinosaWorkspace(fixturePath), ".spinosa/workspace marker")

  if (isSpinosaWorkspace(fixturePath)) {
    const meta = await readWorkspaceMeta(fixturePath)
    push("fixture.meta", Boolean(meta), meta ? `${meta.projectName} (${meta.setupStatus})` : "no meta")

    if (meta) {
      const route = routeForSetupStatus(meta.setupStatus)
      push(
        "fixture.route",
        route.type === "global",
        `expected workspace_started route, got ${route.type}`,
      )
    }

    const corpus = await getCorpusSummary(fixturePath)
    push("fixture.corpus", corpus.hasWorkspaceIndex, `maps=${corpus.mapCount} raw=${corpus.rawCount}`)

    const routes = await getRoutesSnapshot(fixturePath)
    push("fixture.routes", routes.goals.length > 0, `goals=${routes.goals.length} reports=${routes.reports.length}`)

    const health = await getFrameworkHealth(fixturePath)
    const missing = health.filter((row) => !row.ok)
    push(
      "fixture.health",
      missing.length === 0,
      missing.length ? `missing: ${missing.map((row) => row.label).join(", ")}` : "all core files present",
      true,
    )
  }

  const modules = ["orchestrator.ts", "route-recovery.ts", "workspace-bind.tsx"]
  for (const file of modules) {
    const full = path.resolve(path.dirname(fileURLToPath(import.meta.url)), file)
    push(`module.${file}`, existsSync(full), full)
  }

  const goalModule = fileURLToPath(import.meta.resolve("@spinosa/core/artifacts/goal"))
  push("module.@spinosa/core/artifacts/goal", existsSync(goalModule), goalModule)

  const required = checks.filter((check) => !check.optional)
  const passed = required.filter((check) => check.ok).length
  return { checks, passed, failed: required.length - passed }
}

export function formatVerifyReport(report: VerifyReport) {
  const lines = ["Spinosa TUI maturity checks", ""]
  for (const check of report.checks) {
    const tag = check.optional ? "WARN" : check.ok ? "PASS" : "FAIL"
    lines.push(`${tag}  ${check.id} — ${check.detail}`)
  }
  lines.push("", `Result: ${report.passed}/${report.checks.length} passed`)
  return lines.join("\n")
}
