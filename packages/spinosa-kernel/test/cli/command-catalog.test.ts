import { describe, expect, test } from "bun:test"
import { CLI_COMMAND_CATALOG } from "../../src/cli/command-catalog"

describe("lazy CLI command catalog", () => {
  test("registers the TUI as the default command", () => {
    expect(CLI_COMMAND_CATALOG[0]?.command).toBe("$0 [project]")
    expect(CLI_COMMAND_CATALOG.some((spec) => spec.command === "doctor")).toBe(true)
    expect(CLI_COMMAND_CATALOG.some((spec) => spec.command === "version")).toBe(true)
  })

  test("cli-main does not statically import OpenTUI or command modules", async () => {
    const source = await Bun.file(new URL("../../src/cli-main.ts", import.meta.url)).text()
    expect(source).not.toContain("@opentui/solid/preload")
    expect(source).not.toMatch(/from ["']\.\/cli\/cmd\//)
    expect(source).toContain("registerLazyCommands")
  })

  test("tui-entry loads OpenTUI preload before the TUI command", async () => {
    const source = await Bun.file(new URL("../../src/cli/cmd/tui-entry.ts", import.meta.url)).text()
    expect(source.indexOf("@opentui/solid/preload")).toBeGreaterThanOrEqual(0)
    expect(source.indexOf("@opentui/solid/preload")).toBeLessThan(source.indexOf('await import("./tui")'))
  })

  test("product entry handles version before boot-runtime", async () => {
    const source = await Bun.file(new URL("../../src/index.ts", import.meta.url)).text()
    expect(source).toContain("tryHandleFastCli")
    expect(source).toContain("./boot-runtime.ts")
    expect(source).not.toContain("@opentui/solid/preload")
  })
})
