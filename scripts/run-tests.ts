#!/usr/bin/env bun
/**
 * Runs a named group from `scripts/release/test-manifest.ts`.
 *
 * `test:core` / `test:tui` used to carry their own hand-written file lists,
 * which drifted from the CI gate in both directions. Both now read the manifest.
 *
 *   bun scripts/run-tests.ts core    # release-critical + extended core
 *   bun scripts/run-tests.ts tui
 *   bun scripts/run-tests.ts kernel
 */
import { $ } from "bun"
import path from "node:path"
import {
  CORE_EXTENDED_TESTS,
  CORE_RELEASE_TESTS,
  KERNEL_RELEASE_TESTS,
  TUI_LOCAL_TEST_PATHS,
} from "./release/test-manifest.ts"

const root = path.resolve(import.meta.dir, "..")

export interface TestGroup {
  readonly cwd: string
  readonly files: readonly string[]
  readonly isolate: boolean
}

const GROUPS = {
  core: { cwd: "packages/spinosa-core", files: [...CORE_RELEASE_TESTS, ...CORE_EXTENDED_TESTS], isolate: false },
  tui: { cwd: "packages/tui", files: [...TUI_LOCAL_TEST_PATHS], isolate: true },
  kernel: { cwd: "packages/spinosa-kernel", files: [...KERNEL_RELEASE_TESTS], isolate: false },
} as const satisfies Record<string, TestGroup>

// Per-test timeouts matching the quality gate so local runs predict CI.
const GROUP_TIMEOUTS = { core: 30_000, tui: 60_000, kernel: 60_000 } as const

/**
 * Single implementation of "run one bun test group", shared by this CLI and
 * `scripts/quality-release.ts` so timeout/isolate handling cannot drift.
 */
export async function runTestGroup(group: TestGroup, timeoutMs: number): Promise<void> {
  const args = group.isolate ? ["--isolate", ...group.files] : group.files
  const result = await $`bun test --timeout ${timeoutMs} ${args}`.cwd(path.join(root, group.cwd)).nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`bun test failed in ${group.cwd} (exit ${result.exitCode})`)
  }
}

if (import.meta.main) {
  const name = process.argv[2] as keyof typeof GROUPS | undefined
  if (!name || !(name in GROUPS)) {
    console.error(`Usage: bun scripts/run-tests.ts <${Object.keys(GROUPS).join("|")}>`)
    process.exit(1)
  }

  await runTestGroup(GROUPS[name], GROUP_TIMEOUTS[name])
}
