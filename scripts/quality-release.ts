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

const root = path.resolve(import.meta.dir, "..")

const PRODUCT_TYPECHECKS = [
  "packages/spinosa-core",
  "packages/spinosa-cli",
  "packages/spinosa-kernel",
  "packages/spinosa-runtime",
  "packages/tui",
  "packages/sdk",
] as const

const CORE_RELEASE_TESTS = [
  "test/bun-launch.test.ts",
  "test/checksums.test.ts",
  "test/version.test.ts",
  "test/preflight.test.ts",
  "test/channels.test.ts",
  "test/upgrade-errors.test.ts",
  "test/upgrade-network.test.ts",
  "test/uninstall.test.ts",
  "test/version-cache.test.ts",
  "test/distribution.test.ts",
  "../../scripts/release/github.test.ts",
  "../../scripts/release/bump.test.ts",
  "../../scripts/release/lib.test.ts",
  "../../scripts/set-version.test.ts",
] as const

const TUI_RELEASE_TESTS = [
  "test/util/session.test.ts",
  "test/spinosa/update-workspace.test.ts",
  "test/spinosa/create-workspace.test.ts",
  "test/spinosa/install-release.test.ts",
  "test/spinosa/boot.test.ts",
  "test/spinosa/preflight.test.ts",
  "test/spinosa/entry.test.ts",
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
    console.log(`${result.ok ? "✓" : "✗"} ${result.label} (${result.ms}ms)`)
    if (result.detail) console.error(`  ${result.detail}`)
  }
}

async function wave(name: string, jobs: Array<Promise<JobResult>>): Promise<JobResult[]> {
  console.log(`→ ${name} (${jobs.length} parallel)`)
  const results = await Promise.all(jobs)
  report(results)
  return results
}

const started = performance.now()

const wave1 = await wave("wave 1: typecheck + light checks", [
  runJob("typecheck product", typecheckProduct),
  runJob("frozen lockfile", async () => {
    const result = await $`bun install --frozen-lockfile`.cwd(root).nothrow()
    if (result.exitCode !== 0) {
      throw new Error("bun.lock out of sync with package.json — run `bun install` and commit bun.lock")
    }
  }),
  runJob("shellcheck installers", async () => {
    const result = await $`bun run lint:shell`.cwd(root).nothrow()
    if (result.exitCode !== 0) throw new Error("shellcheck failed")
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
  console.error(`✗ release quality failed in wave 1: ${failed1.map((f) => f.label).join(", ")}`)
  process.exit(1)
}

const wave2 = await wave("wave 2: launch / workspace regressions", [
  runJob("kernel cwd / thread", () =>
    bunTest(path.join(root, "packages/spinosa-kernel"), ["test/cli/tui/thread.test.ts"], 30_000),
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
  console.error(`✗ release quality failed in wave 2: ${failed2.map((f) => f.label).join(", ")} (${totalMs}ms)`)
  process.exit(1)
}

console.log(`✓ release quality gate passed (${totalMs}ms)`)
