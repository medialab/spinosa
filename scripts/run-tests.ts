#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"
import {
  CORE_EXTENDED_TESTS,
  CORE_RELEASE_TESTS,
  KERNEL_RELEASE_TESTS,
  TUI_LOCAL_TEST_PATHS,
} from "./release/test-manifest.ts"

const root = path.resolve(import.meta.dir, "..")

const GROUPS = {
  core: { cwd: "packages/spinosa-core", files: [...CORE_RELEASE_TESTS, ...CORE_EXTENDED_TESTS], isolate: false },
  tui: { cwd: "packages/tui", files: [...TUI_LOCAL_TEST_PATHS], isolate: true },
  kernel: { cwd: "packages/spinosa-kernel", files: [...KERNEL_RELEASE_TESTS], isolate: false },
} as const

const name = process.argv[2] as keyof typeof GROUPS | undefined
if (!name || !(name in GROUPS)) {
  console.error(`Usage: bun scripts/run-tests.ts <${Object.keys(GROUPS).join("|")}>`)
  process.exit(1)
}

const group = GROUPS[name]
const args = group.isolate ? ["--isolate", ...group.files] : group.files
const result = await $`bun test ${args}`.cwd(path.join(root, group.cwd)).nothrow()
process.exit(result.exitCode ?? 1)
