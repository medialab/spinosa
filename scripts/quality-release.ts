#!/usr/bin/env bun
/**
 * Release / preflight quality gate (`bun run quality`).
 *
 * Two waves (avoids CPU contention that inflates typecheck wall time):
 *   1. product typechecks ∥ shellcheck ∥ core unit ∥ installer bats
 *   2. kernel cwd ∥ tui release-critical ∥ repo smoke
 *
 * Deep sweeps: `bun run quality:full`.
 * Archive install smoke: release-only via `SPINOSA_SMOKE_FULL=1`.
 */
import { $ } from "bun"
import path from "node:path"
import { fmtElapsed, timestamp } from "./release/log.ts"
// Gate membership lives in one place — see scripts/release/test-manifest.ts.
import { CORE_RELEASE_TESTS, KERNEL_RELEASE_TESTS, TUI_RELEASE_TESTS } from "./release/test-manifest.ts"

const root = path.resolve(import.meta.dir, "..")

const PRODUCT_TYPECHECKS = [
  "packages/spinosa-core",
  "packages/spinosa-cli",
  "packages/spinosa-kernel",
  "packages/spinosa-runtime",
  "packages/tui",
  "packages/sdk",
] as const

type JobResult = { label: string; ok: boolean; ms: number; detail?: string }

async function runJob(label: string, fn: () => Promise<void>): Promise<JobResult> {
  const started = performance.now()
  try {
    await fn()
    return { label, ok: true, ms: Math.round(performance.now() - started) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { label, ok: false, ms: Math.round(performance.now() - started), detail }
  }
}

async function bunTest(cwd: string, files: readonly string[], timeoutMs: number): Promise<void> {
  const result = await $`bun test --timeout ${timeoutMs} ${files}`
    .cwd(cwd)
    .nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`bun test failed (exit ${result.exitCode})`)
  }
}

async function typecheckProduct(): Promise<void> {
  const results = await Promise.all(
    PRODUCT_TYPECHECKS.map(async (workspace) => {
      const result = await $`bun run typecheck`.cwd(path.join(root, workspace)).nothrow()
      return { workspace, ok: result.exitCode === 0 }
    }),
  )
  const failed = results.filter((r) => !r.ok).map((r) => r.workspace)
  if (failed.length > 0) {
    throw new Error(`typecheck failed: ${failed.join(", ")}`)
  }
}

function report(results: JobResult[]): void {
  for (const result of results) {
    console.log(`[${timestamp()}] ${result.ok ? "✓" : "✗"} ${result.label} (${fmtElapsed(result.ms)})`)
    if (result.detail) console.error(`[${timestamp()}]   ${result.detail.split("\n")[0]}`)
  }
}

async function wave(name: string, jobs: Array<Promise<JobResult>>): Promise<JobResult[]> {
  console.log(`[${timestamp()}] [quality] → ${name} (${jobs.length} parallel — per-job lines below)`)
  const results = await Promise.all(jobs)
  report(results)
  return results
}

const started = performance.now()

const wave1 = await wave("wave 1: typecheck + light checks", [
  runJob("typecheck product", typecheckProduct),
  runJob("shellcheck installers", async () => {
    const result = await $`bun run lint:shell`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("shellcheck failed")
  }),
  runJob("actionlint workflows", async () => {
    const result = await $`bash scripts/lint-actions.sh`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("actionlint failed")
  }),
  // Tag releases run the DEFAULT BRANCH copy of the release workflow, so a
  // divergent copy on this branch is reviewed but never shipped.
  runJob("release workflow sync", async () => {
    const result = await $`bun scripts/release/workflow-sync.ts`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("release workflow differs from the default branch")
  }),
  runJob("core release unit tests", () =>
    bunTest(path.join(root, "packages/spinosa-core"), CORE_RELEASE_TESTS, 30_000),
  ),
  runJob("installer bats", async () => {
    const result = await $`bun run test:installer`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("installer bats failed")
  }),
])

const failed1 = wave1.filter((r) => !r.ok)
if (failed1.length > 0) {
  console.error(`[${timestamp()}] ✗ release quality failed in wave 1: ${failed1.map((f) => f.label).join(", ")}`)
  process.exit(1)
}

const wave2 = await wave("wave 2: launch / workspace regressions", [
  runJob("kernel cwd / thread", () =>
    bunTest(path.join(root, "packages/spinosa-kernel"), ["test/cli/tui/thread.test.ts"], 30_000),
  ),
  runJob("kernel smoke aggregation", () =>
    bunTest(
      path.join(root, "packages/spinosa-kernel"),
      [
        "src/cli/cmd/internal-smoke.test.ts",
        "test/cli/tui/worker-boot.test.ts",
        "test/native/boot-noise.test.ts",
        "test/native/dom-matrix-polyfill.test.ts",
        "test/cli/cmd/doctor-probes.test.ts",
        "test/provider/provider-catalog.test.ts",
        "script/embedded-span.test.ts",
      ],
      30_000,
    ),
  ),
  // Provider key redaction + spinosa_report status authority.
  runJob("kernel release-critical", () =>
    bunTest(path.join(root, "packages/spinosa-kernel"), KERNEL_RELEASE_TESTS, 60_000),
  ),
  runJob("tui release-critical", async () => {
    const result = await $`bun test --isolate --timeout 60000 ${TUI_RELEASE_TESTS}`
      .cwd(path.join(root, "packages/tui"))
      .nothrow()
    if (result.exitCode !== 0) throw new Error("tui release-critical failed")
  }),
  runJob("repo smoke", async () => {
    const result = await $`bun scripts/smoke-install.ts`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("repo smoke failed")
  }),
])

const totalMs = Math.round(performance.now() - started)
const failed2 = wave2.filter((r) => !r.ok)
if (failed2.length > 0) {
  console.error(`[${timestamp()}] ✗ release quality failed in wave 2: ${failed2.map((f) => f.label).join(", ")} (${fmtElapsed(totalMs)})`)
  process.exit(1)
}

console.log(`[${timestamp()}] ✓ release quality gate passed (${fmtElapsed(totalMs)})`)
