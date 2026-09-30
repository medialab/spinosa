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

  test("writes startup errors to ~/.spinosa/logs/boot.ndjson without user paths", () => {
    process.env.SPINOSA_HOME = dir
    const leaked = path.join(tmpdir(), `spinosa-private-${process.pid}.md`)
    bootLog("kernel.init", "kernel entry parsing args", {
      cwd: leaked,
      argv: `tui ${leaked}`,
      worktree: leaked,
      pattern: path.join(tmpdir(), "ARCHIVE-GLOBAL-EL2MP-2", ".spinosa", "memory", "notes.md"),
    })
    bootLogError("process.uncaughtException", new Error(`ENOENT: no such file ${leaked}`))
    const text = readFileSync(path.join(dir, "logs", "boot.ndjson"), "utf-8")
    expect(text).toContain("kernel.init")
    expect(text).toContain("process.uncaughtException")
    expect(text).toContain("$PATH.md")
    expect(text).not.toContain(`spinosa-private-${process.pid}`)
    expect(text).not.toContain(leaked)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP-2")
  })

  test("logs an uncaught exception and exits before later work can continue", async () => {
    process.env.SPINOSA_HOME = dir
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        [
          'import { installProcessFailureLogs } from "./src/observability/boot-log.ts"',
          "installProcessFailureLogs()",
          'setTimeout(() => { throw new Error("fatal timer failure") }, 0)',
          'setTimeout(() => console.log("continued after crash"), 100)',
        ].join(";"),
      ],
      {
        cwd: path.resolve(import.meta.dir, ".."),
        env: { ...process.env, SPINOSA_HOME: dir },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(exitCode).toBe(1)
    expect(stdout).not.toContain("continued after crash")
    const text = readFileSync(path.join(dir, "logs", "boot.ndjson"), "utf-8")
    expect(text).toContain("process.uncaughtException")
    expect(text).toContain("fatal timer failure")
  })

  test("keeps the intentional nonfatal unhandled-rejection policy", async () => {
    process.env.SPINOSA_HOME = dir
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        [
          'import { installProcessFailureLogs } from "./src/observability/boot-log.ts"',
          "installProcessFailureLogs()",
          'Promise.reject(new Error("reported rejection"))',
          'setTimeout(() => console.log("continued after rejection"), 25)',
        ].join(";"),
      ],
      {
        cwd: path.resolve(import.meta.dir, ".."),
        env: { ...process.env, SPINOSA_HOME: dir },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(exitCode).toBe(0)
    expect(stdout).toContain("continued after rejection")
    const text = readFileSync(path.join(dir, "logs", "boot.ndjson"), "utf-8")
    expect(text).toContain("process.unhandledRejection")
    expect(text).toContain("reported rejection")
  })
})
