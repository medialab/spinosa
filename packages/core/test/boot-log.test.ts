import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { bootLog, bootLogError } from "../src/observability/boot-log"

describe("bootLog", () => {
  const previousHome = process.env.SPINOSA_HOME
  const dir = mkdtempSync(path.join(tmpdir(), "spinosa-boot-log-"))

  afterEach(() => {
    if (previousHome === undefined) delete process.env.SPINOSA_HOME
    else process.env.SPINOSA_HOME = previousHome
    rmSync(dir, { recursive: true, force: true })
  })

  test("writes startup errors to ~/.spinosa/logs/boot.tui.ndjson without user paths", () => {
    process.env.SPINOSA_HOME = dir
    const leaked = path.join(tmpdir(), `spinosa-private-${process.pid}.md`)
    bootLog("kernel.init", "kernel entry parsing args", {
      cwd: leaked,
      argv: `tui ${leaked}`,
      worktree: leaked,
      pattern: path.join(tmpdir(), "ARCHIVE-GLOBAL-EL2MP-2", ".spinosa", "memory", "notes.md"),
    })
    bootLogError("process.uncaughtException", new Error(`ENOENT: no such file ${leaked}`))
    bootLogError("process.nested", new Error("outer failure", { cause: new Error("inner failure") }))
    const text = readFileSync(path.join(dir, "logs", "boot.tui.ndjson"), "utf-8")
    expect(text).toContain("kernel.init")
     expect(text).toContain("process.uncaughtException")
     expect(text).toContain("process.nested")
     expect(text).toContain("Caused by:")
     expect(text).toContain("inner failure")
     expect(text).toContain("$PATH.md")

    expect(text).not.toContain(`spinosa-private-${process.pid}`)
    expect(text).not.toContain(leaked)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP-2")
  })
})
