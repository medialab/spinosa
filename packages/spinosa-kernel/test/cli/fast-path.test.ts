import { describe, expect, test } from "bun:test"
import { formatBareVersionOutput, isBareVersionArgv, stripGlobalCliFlags, tryHandleFastCli } from "../../src/cli/fast-path"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"

describe("CLI version fast path", () => {
  test("strips global flags so bare -v still matches", () => {
    expect(stripGlobalCliFlags(["--verbose", "-v", "--print-logs"])).toEqual(["-v"])
    expect(stripGlobalCliFlags(["--log-level", "DEBUG", "--version"])).toEqual(["--version"])
  })

  test("accepts -v, --version, and version with global flags only", () => {
    expect(isBareVersionArgv(["-v"])).toBe(true)
    expect(isBareVersionArgv(["--version"])).toBe(true)
    expect(isBareVersionArgv(["version"])).toBe(true)
    expect(isBareVersionArgv(["--verbose", "version"])).toBe(true)
    expect(isBareVersionArgv(["version", "--json"])).toBe(false)
    expect(isBareVersionArgv(["doctor"])).toBe(false)
    expect(isBareVersionArgv([])).toBe(false)
  })

  test("prints the yargs version for -v and the command summary for version", () => {
    expect(formatBareVersionOutput(["-v"])).toBe(InstallationVersion)
    expect(formatBareVersionOutput(["--version"])).toBe(InstallationVersion)
    expect(formatBareVersionOutput(["version"])).toBe(`spinosa ${InstallationVersion}`)
  })

  test("writes output and reports handled", () => {
    const lines: string[] = []
    expect(tryHandleFastCli(["bun", "index.ts", "--version"], (text) => lines.push(text))).toBe(true)
    expect(lines).toEqual([`${InstallationVersion}\n`])
    expect(tryHandleFastCli(["bun", "index.ts", "doctor"], (text) => lines.push(text))).toBe(false)
  })
})
