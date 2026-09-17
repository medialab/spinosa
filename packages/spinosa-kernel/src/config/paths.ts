import path from "path"
import fs from "fs/promises"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { Global } from "@spinosa/kernel-core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@spinosa/kernel-core/fs-util"

const legacyName = ["open", "code"].join("")
const productName = "spinosa"
const migrationReport = ".spinosa-migration-report.json"

export type ProjectMigrationResult = {
  source: string
  target: string
  result: "migrated" | "conflict" | "absent" | "skipped"
}

async function exists(file: string) {
  return fs.stat(file).then(() => true).catch(() => false)
}

async function migratePath(source: string, target: string): Promise<ProjectMigrationResult> {
  if (!(await exists(source))) return { source, target, result: "absent" }
  if (await exists(target)) return { source, target, result: "conflict" }
  try {
    await fs.rename(source, target)
    return { source, target, result: "migrated" }
  } catch {
    // Read-only mounts (Lima virtiofs, NFS) must not abort TUI launch.
    return { source, target, result: "skipped" }
  }
}

async function writeMigrationReport(directory: string, conflicts: ProjectMigrationResult[]) {
  const root = path.resolve(directory)
  if (!(await exists(root))) return
  const file = path.join(root, migrationReport)
  const persisted = conflicts.map((conflict) => ({
    ...conflict,
    source: path.relative(root, conflict.source),
    target: path.relative(root, conflict.target),
  }))
  try {
    const existing = await fs
      .readFile(file, "utf8")
      .then((value) => JSON.parse(value) as { version?: number; conflicts?: ProjectMigrationResult[] })
      .catch(() => undefined)
    if (existing?.version === 1 && JSON.stringify(existing.conflicts) === JSON.stringify(persisted)) {
      await fs.chmod(file, 0o600)
      return
    }
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), conflicts: persisted }, null, 2) + "\n",
      { mode: 0o600 },
    )
    await fs.chmod(file, 0o600)
  } catch {
    // Best-effort report: EROFS/EACCES on the launch cwd is not a launch failure.
  }
}

export async function migrateProjectPaths(directory: string, worktree?: string) {
  const stop = path.resolve(worktree ?? path.parse(path.resolve(directory)).root)
  let current = path.resolve(directory)
  const results: ProjectMigrationResult[] = []
  while (true) {
    results.push(
      await migratePath(path.join(current, `.${legacyName}`), path.join(current, `.${productName}`)),
      await migratePath(path.join(current, `${legacyName}.json`), path.join(current, `${productName}.json`)),
      await migratePath(path.join(current, `${legacyName}.jsonc`), path.join(current, `${productName}.jsonc`)),
    )
    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  const conflicts = results.filter((result) => result.result === "conflict")
  if (conflicts.length > 0) {
    await writeMigrationReport(directory, conflicts)
  }
  return results
}

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (name: string, directory: string, worktree?: string) {
  yield* Effect.tryPromise(() => migrateProjectPaths(directory, worktree)).pipe(Effect.ignore)
  const afs = yield* FSUtil.Service
  const targets =
    name === productName ? [`${productName}.jsonc`, `${productName}.json`] : [`${name}.jsonc`, `${name}.json`]
  return (yield* afs.up({ targets, start: directory, stop: worktree })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  yield* Effect.tryPromise(() => migrateProjectPaths(directory, worktree)).pipe(Effect.ignore)
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.SPINOSA_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({ targets: [`.${productName}`], start: directory, stop: worktree })
      : []),
    ...(yield* afs.up({
      targets: [`.${productName}`],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.SPINOSA_CONFIG_DIR ? [Flag.SPINOSA_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

export * as ConfigPaths from "./paths"
