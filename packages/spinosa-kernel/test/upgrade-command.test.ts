import { describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"

describe("spinosa upgrade CLI", () => {
  test("does not offer workspace template updates after a successful upgrade", async () => {
    const source = await readFile(new URL("../src/cli/cmd/upgrade.ts", import.meta.url), "utf8")
    expect(source).not.toContain("offerWorkspaceUpgrades")
    expect(source).not.toContain("updateWorkspace")
  })
})
