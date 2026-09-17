import { describe, expect, test } from "bun:test"
import { cleanReinstallOutput } from "../../src/spinosa/reinstall"

describe("vendor-tool reinstall output", () => {
  test("removes ANSI and spinner control output while preserving text", () => {
    expect(
      cleanReinstallOutput("\x1b[32mDownloading\x1b[0m\r\n\r\nready\r"),
    ).toBe("Downloading\nready")
  })

  test("returns an empty string for control-only chunks", () => {
    expect(cleanReinstallOutput("\x1b[2K\r\n")).toBe("")
  })
})
