import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  buildBugReportUrl,
  collectRecentErrorLogs,
  groupRepeatedLogLines,
  MAX_BUG_REPORT_URL_LENGTH,
  openBugReport,
  reportBugFromTui,
} from "../../src/spinosa/bug-report"

describe("collectRecentErrorLogs", () => {
  test("keeps recent boot and TUI lines, skips debug.tui.ndjson", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, "logs")
    await mkdir(logDir, { recursive: true })
    const now = Date.now()
    await writeFile(
      path.join(logDir, "tui.ndjson"),
      [
        JSON.stringify({ ts: new Date(now - 2000).toISOString(), level: "info", event: "action", msg: "clicked models" }),
        JSON.stringify({
          ts: new Date(now - 1000).toISOString(),
          level: "error",
          event: "error",
          msg: "provider failed",
          content: "secret model answer that must not leak",
        }),
      ].join("\n") + "\n",
    )
    await writeFile(
      path.join(logDir, "boot.tui.ndjson"),
      [
        JSON.stringify({ ts: now - 500, pid: 1, tag: "cli.start", msg: "starting tui" }),
        JSON.stringify({ ts: now, tag: "process.uncaughtException", msg: "boom", level: "error" }),
      ].join("\n") + "\n",
    )
    await writeFile(
      path.join(logDir, "debug.tui.ndjson"),
      JSON.stringify({ ts: new Date(now).toISOString(), level: "error", msg: "debug dump must stay local" }) + "\n",
    )

    const logs = collectRecentErrorLogs({ logDir })
    expect(logs).toContain("clicked models")
    expect(logs).toContain("starting tui")
    expect(logs).toContain("provider failed")
    expect(logs).toContain("process.uncaughtException")
    expect(logs).not.toContain("secret model answer")
    expect(logs).not.toContain("debug dump must stay local")
  })

  test("collapses consecutive identical lines to xN", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, "logs")
    await mkdir(logDir, { recursive: true })
    const now = Date.now()
    const fetches = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({
        ts: now - 600 + i,
        pid: 48198,
        tag: "worker.fetch",
        msg: "proxying fetch",
        method: "GET",
      }),
    )
    await writeFile(
      path.join(logDir, "boot.tui.ndjson"),
      [
        JSON.stringify({ ts: now - 700, pid: 48198, tag: "bootstrap.run.done", msg: "InstanceBootstrap.run completed" }),
        ...fetches,
      ].join("\n") + "\n",
    )

    const logs = collectRecentErrorLogs({ logDir })
    expect(logs).toContain("InstanceBootstrap.run completed")
    expect(logs).toMatch(/ x6(?:\n|$)/)
    expect(logs.split("\n").filter((line) => line.includes("worker.fetch"))).toHaveLength(1)
    expect(groupRepeatedLogLines(['{"tag":"a"}', '{"tag":"a"}', '{"tag":"b"}', '{"tag":"b"}', '{"tag":"b"}'])).toEqual([
      '{"tag":"a"} x2',
      '{"tag":"b"} x3',
    ])
  })

  test("returns a placeholder when no recent lines exist", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, "logs")
    await mkdir(logDir, { recursive: true })
    await writeFile(path.join(logDir, "tui.ndjson"), "")
    const logs = collectRecentErrorLogs({ logDir })
    expect(logs).toContain("No recent TUI or boot log lines")
  })

  test("redacts corpus paths and drops assistant transcripts", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, "logs")
    await mkdir(logDir, { recursive: true })
    const now = Date.now()
    const corpus = path.join(homedir(), "Documents", "secret-vault", "notes.md")
    await writeFile(
      path.join(logDir, "tui.ndjson"),
      [
        JSON.stringify({
          ts: new Date(now - 1000).toISOString(),
          level: "error",
          event: "error",
          msg: `failed at ${corpus}`,
          directory: corpus,
        }),
        JSON.stringify({
          ts: new Date(now).toISOString(),
          level: "error",
          role: "assistant",
          msg: "I would answer the user here",
        }),
      ].join("\n") + "\n",
    )

    const logs = collectRecentErrorLogs({ logDir })
    expect(logs).toContain("$PATH.md")
    expect(logs).not.toContain("secret-vault")
    expect(logs).not.toContain(homedir())
    expect(logs).not.toContain("I would answer the user here")
  })

  test("drops stale boot errors and redacts stack frames from other checkouts", async () => {
    await using tmp = await tmpdir()
    const logDir = path.join(tmp.path, "logs")
    await mkdir(logDir, { recursive: true })
    const now = Date.now()
    const home = homedir()
    const worktree = path.join(home, "Documents", "spinosa-desktop-worktree", "node_modules", "@effect", "NodeHttpServer.js")
    await writeFile(
      path.join(logDir, "boot.tui.ndjson"),
      [
        JSON.stringify({
          ts: now - 3 * 60 * 60 * 1000,
          tag: "kernel.error",
          msg: "unhandled error",
          error: "ServeError",
          chain: `ServeError: ServeError\n    at onError (${worktree}:74:30)`,
        }),
        JSON.stringify({
          ts: now - 60_000,
          tag: "kernel.error",
          msg: "unhandled error",
          error: "ServeError",
          chain: `ServeError: ServeError\n    at onError (${worktree}:74:30)`,
        }),
      ].join("\n") + "\n",
    )

    const logs = collectRecentErrorLogs({ logDir })
    expect(logs).not.toContain("spinosa-desktop-worktree")
    expect(logs).not.toContain(home)
    expect(logs).toContain("ServeError")
    expect(logs).toContain("$PATH")
    expect(logs.split("\n").filter(Boolean)).toHaveLength(1)
  })
})

describe("buildBugReportUrl", () => {
  test("prefills the GitHub bug form and sanitizes crash details", () => {
    const home = homedir()
    const url = buildBugReportUrl({
      kind: "crash",
      message: `Cannot read ${path.join(home, "thesis.pdf")}`,
      stack: `Error: boom\n    at ${path.join(home, "Documents", "app.ts")}:12`,
      logs: "",
      version: "1.2.0-test",
    })

    expect(url.origin + url.pathname).toBe("https://github.com/medialab/spinosa/issues/new")
    expect(url.searchParams.get("template")).toBe("bug_report.yml")
    expect(url.searchParams.get("title")).toContain("[Bug]: TUI crash:")
    expect(url.searchParams.get("summary")).toContain("crashed")
    expect(url.searchParams.get("environment")).toContain("1.2.0-test")
    expect(url.searchParams.get("actual")).not.toContain("thesis.pdf")
    expect(url.searchParams.get("logs")).not.toContain(home)
    expect(url.searchParams.get("logs")).toContain("$PATH")
    expect(url.searchParams.has("body")).toBe(false)
  })

  test("keeps the encoded URL under the GitHub budget", () => {
    const url = buildBugReportUrl({
      kind: "crash",
      message: "x".repeat(4000),
      stack: "stack ".repeat(8000),
      logs: JSON.stringify({ level: "error", msg: "y".repeat(8000) }).repeat(50),
      version: "1.2.0-test",
    })
    expect(url.toString().length).toBeLessThanOrEqual(MAX_BUG_REPORT_URL_LENGTH)
    expect(url.searchParams.get("logs") ?? "").toContain("truncated")
  })

  test("user reports prefill environment and logs only", () => {
    const url = buildBugReportUrl({
      kind: "user",
      logs: '{"level":"error","msg":"provider failed"}',
      version: "1.2.0-test",
    })
    expect(url.searchParams.get("template")).toBe("bug_report.yml")
    expect(url.searchParams.get("title")).toBe("[Bug]: ")
    expect(url.searchParams.get("environment")).toContain("1.2.0-test")
    expect(url.searchParams.get("logs")).toContain("provider failed")
    expect(url.searchParams.has("summary")).toBe(false)
    expect(url.searchParams.has("steps")).toBe(false)
  })
})

describe("openBugReport", () => {
  test("returns opened when the browser opens", async () => {
    const opened: string[] = []
    const copied: string[] = []
    const result = await openBugReport(new URL("https://github.com/medialab/spinosa/issues/new"), {
      openUrl: async (href) => {
        opened.push(href)
      },
      writeClipboard: async (text) => {
        copied.push(text)
      },
    })
    expect(result).toBe("opened")
    expect(opened).toHaveLength(1)
    expect(copied).toHaveLength(1)
  })

  test("returns copied when the browser fails", async () => {
    const result = await openBugReport(new URL("https://github.com/medialab/spinosa/issues/new"), {
      openUrl: async () => {
        throw new Error("no browser")
      },
      writeClipboard: async () => {},
    })
    expect(result).toBe("copied")
  })
})

describe("reportBugFromTui", () => {
  test("does not open GitHub when the user cancels", async () => {
    let opened = false
    const result = await reportBugFromTui({
      confirm: async () => false,
      showToast: () => {},
      openUrl: async () => {
        opened = true
      },
    })
    expect(result).toBe("cancelled")
    expect(opened).toBe(false)
  })

  test("opens the form and toasts the GitHub destination after confirm", async () => {
    const toasts: { variant: string; message: string }[] = []
    const result = await reportBugFromTui({
      confirm: async () => true,
      showToast: (input) => {
        toasts.push(input)
      },
      openUrl: async () => {},
      writeClipboard: async () => {},
      logs: "",
    })
    expect(result).toBe("opened")
    expect(toasts[0]?.variant).toBe("success")
    expect(toasts[0]?.message).toContain("github.com/medialab/spinosa")
  })
})
