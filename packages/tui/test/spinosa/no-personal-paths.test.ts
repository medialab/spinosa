import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

// Built at runtime so this file does not embed the forbidden literal itself.
// Resolve the current home at runtime so no contributor name is embedded here.
const runtimeHome = process.env.HOME?.replaceAll("\\", "/").replace(/\/$/, "")
const localCloneMarker = ["Documents", "spinosa-main"].join("/")

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
}

describe("no personal machine paths in tracked files", () => {
  test("git ls-files has no local clone paths", () => {
    const files = trackedFiles()

    const pathHits = files.filter((file) => {
      if (file.includes(localCloneMarker)) return true
      // Accidental install.sh die() message turned into a filename
      if (file.includes("Cannot read from terminal")) return true
      return false
    })
    expect(pathHits).toEqual([])
  })

  test("tracked file contents do not embed maintainer home directory", async () => {
    const files = trackedFiles()
    const self = path.relative(repoRoot, import.meta.path)

    const contentHits: string[] = []
    for (const file of files) {
      if (file === self) continue
      if (/\.(png|jpg|jpeg|gif|webp|woff2?|ttf|ico|gz|tgz)$/i.test(file)) continue

      const abs = path.join(repoRoot, file)
      const bunFile = Bun.file(abs)
      if (!(await bunFile.exists())) continue
      if (bunFile.size > 2_000_000) continue

      let text: string
      try {
        text = await bunFile.text()
      } catch {
        continue
      }

      // Detect the machine running the audit without embedding a contributor's
      // username in the public test source.
      if ((runtimeHome && text.includes(runtimeHome)) || text.includes(localCloneMarker)) {
        contentHits.push(file)
      }
    }

    expect(contentHits).toEqual([])
  })

  test("no tracked workspace log or ndjson artifacts", () => {
    const files = trackedFiles()

    const logHits = files.filter((file) => {
      if (!/\.(log|ndjson)$/i.test(file)) return false
      // Template scaffold only — no runtime traces
      if (file === "workspace-template/.logs/.gitkeep") return false
      if (file === "workspace-template/.logs/AGENTS.md") return false
      return true
    })

    expect(logHits).toEqual([])
  })
})
