import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { stageToolsTarball } from "./smoke-install.ts"

describe("smoke tools-tarball removal (no engine ships)", () => {
  test("stageToolsTarball is a fail-closed removal stub", async () => {
    expect(stageToolsTarball("/tmp/does-not-exist.tar.gz", "/tmp/home", "test binary")).rejects.toThrow(
      /tools tarballs no longer exist/,
    )
  })

  test("--tools flag was removed", async () => {
    const root = path.resolve(import.meta.dir, "..")
    const result = await $`bun scripts/smoke-install.ts --help`.cwd(root).nothrow().quiet()
    expect(String(result.text())).not.toContain("--tools")
  })
})
