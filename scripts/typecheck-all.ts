#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { $ } from "bun"

const root = path.resolve(import.meta.dir, "..")
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
  workspaces: { packages: string[] }
}

const failures: string[] = []

for (const workspace of packageJson.workspaces.packages) {
  const packagePath = path.join(root, workspace)
  const manifestPath = path.join(packagePath, "package.json")
  if (!existsSync(manifestPath)) continue

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { scripts?: Record<string, string> }
  if (!manifest.scripts?.typecheck) continue

  console.log(`→ typecheck ${workspace}`)
  const result = await $`bun run typecheck`.cwd(packagePath).nothrow()
  if (result.exitCode !== 0) failures.push(workspace)
}

if (failures.length > 0) {
  console.error(`Typecheck failed in: ${failures.join(", ")}`)
  process.exit(1)
}

console.log("✓ all workspace typechecks passed")
