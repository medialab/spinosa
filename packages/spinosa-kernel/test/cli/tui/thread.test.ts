import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import yargs from "yargs"
import { tmpdir } from "../../fixture/fixture"
import { TuiThreadCommand, resolveSessionDirectory, resolveThreadDirectory } from "../../../src/cli/cmd/tui"
import { validateSession } from "../../../src/cli/tui/validate-session"
import { cliIt } from "../../lib/cli-process"

describe("tui thread", () => {
  test("loads the TUI integration lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/tui.ts", import.meta.url)).text()

    expect(source).toContain('await import("../tui/layer")')
    expect(source).toMatch(/await import\(["']@\/plugin\/tui\/runtime["']\)/)
    expect(source).not.toContain('import("./app")')
  })

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("resolves a relative mini project from PWD when cwd differs", async () => {
    await using pwd = await tmpdir({ git: true })
    await using cwd = await tmpdir({ git: true })

    expect(resolveThreadDirectory(".", pwd.path, cwd.path)).toBe(pwd.path)
    expect(resolveThreadDirectory(undefined, pwd.path, cwd.path)).toBe(cwd.path)
  })

  test("prefers PWD when Bun --cwd pointed at the framework install root", async () => {
    await using pwd = await tmpdir({ git: true })
    await using framework = await tmpdir({})
    await fs.mkdir(path.join(framework.path, "packages", "spinosa-kernel", "src"), { recursive: true })
    await Bun.write(path.join(framework.path, "packages", "spinosa-kernel", "src", "index.ts"), "export {}\n")

    expect(resolveThreadDirectory(undefined, pwd.path, framework.path)).toBe(pwd.path)
    // Still use real cwd when PWD is only a symlink to the same project tree.
    expect(resolveThreadDirectory(undefined, pwd.path, pwd.path)).toBe(pwd.path)
  })

  test("resolveSessionDirectory routes to the session dir unless project is explicit", async () => {
    await using sessionDir = await tmpdir({})
    await using cwd = await tmpdir({})
    expect(resolveSessionDirectory({ currentDirectory: cwd.path, sessionDirectory: sessionDir.path })).toBe(
      sessionDir.path,
    )
    expect(
      resolveSessionDirectory({
        explicitProject: "/other",
        currentDirectory: cwd.path,
        sessionDirectory: sessionDir.path,
      }),
    ).toBe(cwd.path)
    expect(resolveSessionDirectory({ currentDirectory: cwd.path })).toBe(cwd.path)
    expect(resolveSessionDirectory({ currentDirectory: cwd.path, sessionDirectory: "  " })).toBe(cwd.path)
    expect(resolveSessionDirectory({ currentDirectory: cwd.path, sessionDirectory: "sub/dir" })).toBe(
      path.join(cwd.path, "sub/dir"),
    )
  })

  test("validateSession returns the session directory without a network client", async () => {
    const validated = await validateSession({
      url: "http://127.0.0.1:1",
      sessionID: "ses_12345678901234567890123456",
      client: {
        session: {
          get: async () => ({ data: { directory: "/tmp/project" } }),
        },
      },
    })
    expect(validated).toEqual({ directory: "/tmp/project" })
    await expect(validateSession({ url: "http://127.0.0.1:1" })).resolves.toEqual({})
    await expect(
      validateSession({ url: "http://127.0.0.1:1", sessionID: "not-a-session-id" }),
    ).rejects.toThrow("Invalid session ID")
  })

  test("parses supported --no-replay forms", async () => {
    for (const option of ["--no-replay", "--no-replay=true", "--noReplay"]) {
      const args = await yargs([])
        .command({ ...TuiThreadCommand, handler: () => {} })
        .exitProcess(false)
        .parse(["--mini", option, "--replay-limit", "10"])

      expect(args.replay === false || args.noReplay === true).toBe(true)
      expect(args.replayLimit).toBe(10)
    }
  })

  test("preserves boolean negation for existing options", async () => {
    const args = await yargs([])
      .command({ ...TuiThreadCommand, handler: () => {} })
      .exitProcess(false)
      .parse(["--mdns", "--no-mdns"])

    expect(args.mdns).toBe(false)
  })

  cliIt.live("rejects mini-only options without --mini", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--replay-limit", "10"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--replay-limit requires --mini")
    }),
  )

  cliIt.live("routes attached sessions to mini mode", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["attach", "http://127.0.0.1:1", "--mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--mini requires a TTY stdout")
    }),
  )

  cliIt.live("rejects network options in mini mode", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--mini", "--port", "4096"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--port cannot be used with --mini")
    }),
  )
})
