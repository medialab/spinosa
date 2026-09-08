import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { releaseTemplateInputs } from "./template-inputs"

test("release templates exclude ignored and untracked developer files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-pack-inputs-"))
  try {
    execFileSync("git", ["init", "-q", root])
    mkdirSync(path.join(root, "workspace-template/.opencode"), { recursive: true })
    writeFileSync(path.join(root, ".gitignore"), "package-lock.json\n")
    const files = [".opencode/config.json", ".opencode/package-lock.json", ".opencode/private-note.md"].map(
      (relativePath) => {
        const sourcePath = path.join(root, "workspace-template", relativePath)
        writeFileSync(sourcePath, "fixture")
        return { relativePath, sourcePath, mode: 0o644, sha256: "fixture" }
      },
    )
    execFileSync("git", ["add", "workspace-template/.opencode/config.json"], { cwd: root })
    expect(releaseTemplateInputs(root, files)).toEqual([files[0]!])
    // GitHub source archives have no .git and must remain buildable without Git.
    rmSync(path.join(root, ".git"), { recursive: true })
    expect(releaseTemplateInputs(root, [files[0]!])).toEqual([files[0]!])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
