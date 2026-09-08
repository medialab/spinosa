import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import type { ManifestFile } from "../../packages/spinosa-core/src/framework/template-pack"

/** Ignore local workspace state when building from Git; source archives are already filtered. */
export function releaseTemplateInputs(root: string, files: ManifestFile[]): ManifestFile[] {
  if (!existsSync(path.join(root, ".git"))) return files
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z", "--", "workspace-template/"], {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 16 * 1024 * 1024,
    }).split("\0"),
  )
  return files.filter((file) => tracked.has(`workspace-template/${file.relativePath}`))
}
