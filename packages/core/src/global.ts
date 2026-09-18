import path from "path"
import { mkdirSync } from "fs"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"
import { productLogDir, resolveUserDirs } from "./util/user-dirs"

const legacyApp = ["open", "code"].join("")
const app = "spinosa"
const migrationManifest = "migration-manifest.json"
const migrationLock = ".spinosa-migration.lock"

type Paths = Record<"data" | "cache" | "config" | "state" | "tmp", string>

export type MigrationResult = {
  source: string
  target: string
  result: "migrated" | "conflict" | "absent" | "invalid"
}

const legacyPaths: Paths = {
  data: path.join(xdgData!, legacyApp),
  cache: path.join(xdgCache!, legacyApp),
  config: path.join(xdgConfig!, legacyApp),
  state: path.join(xdgState!, legacyApp),
  tmp: path.join(os.tmpdir(), legacyApp),
}

const userHome = process.env.SPINOSA_TEST_HOME ?? os.homedir()
const userDirs = resolveUserDirs({ home: userHome })

const spinosaPaths: Paths = {
  data: userDirs.data,
  cache: userDirs.cache,
  config: userDirs.config,
  state: userDirs.state,
  tmp: path.join(os.tmpdir(), app),
}

async function exists(file: string) {
  return fs.stat(file).then(() => true).catch(() => false)
}

async function validateSqliteFiles(directory: string): Promise<boolean> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!(await validateSqliteFiles(file))) return false
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".db")) continue

    try {
      const { Database } = await import("bun:sqlite")
      using db = new Database(file, { readonly: true })
      const check = db.query("PRAGMA integrity_check").get() as { integrity_check?: string }
      if (check.integrity_check !== "ok") return false
    } catch {
      return false
    }
  }
  return true
}

async function renameLegacyConfigFiles(directory: string) {
  for (const extension of ["json", "jsonc"]) {
    const source = path.join(directory, `${legacyApp}.${extension}`)
    const target = path.join(directory, `${app}.${extension}`)
    if ((await exists(source)) && !(await exists(target))) await fs.rename(source, target)
  }
}

async function migrateDirectory(source: string, target: string, configDirectory = false): Promise<MigrationResult> {
  if (!(await exists(source))) return { source, target, result: "absent" }
  if (await exists(target)) return { source, target, result: "conflict" }

  const staging = `${target}.migrating-${process.pid}-${Date.now()}`
  try {
    await fs.cp(source, staging, { recursive: true, force: false, errorOnExist: true })
    if (!(await validateSqliteFiles(staging))) {
      await fs.rm(staging, { recursive: true, force: true })
      return { source, target, result: "invalid" }
    }
    if (configDirectory) {
      await renameLegacyConfigFiles(staging)
    }
    await fs.rename(staging, target)
    return { source, target, result: "migrated" }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function migrateLegacyPaths(input: { legacy: Paths; spinosa: Paths }) {
  const lockDirectory = path.dirname(input.spinosa.data)
  const lock = path.join(lockDirectory, migrationLock)
  await fs.mkdir(lockDirectory, { recursive: true })
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(lock, "wx")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return [] as MigrationResult[]
    throw error
  }

  try {
    const results = await Promise.all(
      (Object.keys(input.legacy) as Array<keyof Paths>).map((name) =>
        migrateDirectory(input.legacy[name], input.spinosa[name], name === "config"),
      ),
    )
    const manifestTarget = path.join(input.spinosa.data, migrationManifest)
    if (results.some((result) => result.result !== "absent")) {
      await fs.mkdir(input.spinosa.data, { recursive: true })
      await fs.writeFile(
        manifestTarget,
        JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), results }, null, 2) + "\n",
      )
    }
    return results
  } finally {
    await handle.close()
    await fs.rm(lock, { force: true })
  }
}

const globalPath = {
  home: userHome,
  cache: userDirs.cache,
  data: userDirs.data,
  config: userDirs.config,
  state: userDirs.state,
  tmp: path.join(os.tmpdir(), app),
  bin: userDirs.bin,
  log: productLogDir({ home: userHome }),
  repos: userDirs.repos,
}

Flock.setGlobal({ state: globalPath.state })

for (const dir of [globalPath.data, globalPath.config, globalPath.state, globalPath.tmp, globalPath.log, globalPath.bin, globalPath.repos]) {
  mkdirSync(dir, { recursive: true })
}

/** Legacy-path migration runs after mkdir. Boot awaits this before CLI parse. */
export const GlobalReady = migrateLegacyPaths({ legacy: legacyPaths, spinosa: spinosaPaths }).catch(() => [] as MigrationResult[])

export namespace Global {
  export const Path = globalPath

  export interface Interface {
    home: string
    data: string
    cache: string
    config: string
    state: string
    tmp: string
    bin: string
    log: string
    repos: string
  }

  export class Service extends Context.Service<Service, Interface>()("@spinosa/Global") {}

  export function make(input: Partial<Interface> = {}): Interface {
    return {
      home: Path.home,
      data: Path.data,
      cache: Path.cache,
      config: Flag.SPINOSA_CONFIG_DIR ?? Path.config,
      state: Path.state,
      tmp: Path.tmp,
      bin: Path.bin,
      log: Path.log,
      repos: Path.repos,
      ...input,
    }
  }

  const layer = Layer.effect(Service, Effect.sync(() => Service.of(make())))
  export const node = makeGlobalNode({ service: Service, layer, deps: [] })
  export const layerWith = (input: Partial<Interface>) =>
    Layer.effect(Service, Effect.sync(() => Service.of(make(input))))
}

export * from "./global"
