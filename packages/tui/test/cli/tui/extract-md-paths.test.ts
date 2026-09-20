import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { extractMdPaths } from "../../../src/routes/session/extract-md-paths"

describe("extractMdPaths", () => {
  test("filters missing files while keeping existing workspace markdown links", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spinosa-md-paths-"))
    const reports = path.join(root, "agent_reports")
    try {
      await mkdir(reports)
      await writeFile(path.join(reports, "g_20260731.md"), "# goal\n")

      const found = extractMdPaths(
        "Open agent_reports/g_20260731.md or agent_reports/c_20260731.md later.",
        root,
      )
      expect(found).toEqual(["agent_reports/g_20260731.md"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("can skip existsSync while text is still streaming", () => {
    expect(
      extractMdPaths("See notes/draft.md later.", "/tmp/never-this-workspace", { checkExists: false }),
    ).toEqual(["notes/draft.md"])
  })
})
