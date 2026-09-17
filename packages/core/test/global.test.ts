import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global, migrateLegacyPaths } from "@spinosa/kernel-core/global"

type TestPaths = Record<"data" | "cache" | "config" | "state" | "tmp", string>

function fixturePaths(root: string, name: string): TestPaths {
  return Object.fromEntries(
    ["data", "cache", "config", "state", "tmp"].map((kind) => [kind, path.join(root, name, kind)]),
  ) as TestPaths
}

describe("global paths", () => {
  test("tmp path is under system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "spinosa"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tool binaries do not share the installer runtime directory", () => {
    expect(Global.Path.bin).toBe(path.join(Global.Path.cache, "bin"))
    expect(Global.Path.bin).not.toBe(path.join(Global.Path.home, ".spinosa", "bin"))
    expect(Global.Path.data.startsWith(Global.Path.home)).toBe(true)
    expect(Global.Path.log).toBe(path.join(Global.Path.home, ".spinosa", "logs"))
  })

  test("tmp path created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("copies legacy global state into Spinosa paths and records a manifest", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spinosa-migration-"))
    const legacy = fixturePaths(root, "legacy")
    const spinosa = fixturePaths(root, "spinosa")
    try {
      await fs.mkdir(legacy.config, { recursive: true })
      await fs.mkdir(legacy.data, { recursive: true })
      await fs.writeFile(path.join(legacy.config, "opencode.jsonc"), '{ "model": "test/model" }')
      using db = new Database(path.join(legacy.data, "opencode.db"))
      db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY)")
      db.run("INSERT INTO sessions VALUES ('preserved')")

      const results = await migrateLegacyPaths({ legacy, spinosa })

      expect(results.every((result) => result.result === "migrated" || result.result === "absent")).toBe(true)
      expect(await fs.readFile(path.join(spinosa.config, "spinosa.jsonc"), "utf8")).toContain("test/model")
      using migrated = new Database(path.join(spinosa.data, "opencode.db"), { readonly: true })
      expect(migrated.query("SELECT id FROM sessions").get()).toEqual({ id: "preserved" })
      expect(JSON.parse(await fs.readFile(path.join(spinosa.data, "migration-manifest.json"), "utf8"))).toMatchObject({ version: 1 })
      expect(await fs.stat(path.join(legacy.data, "opencode.db"))).toBeDefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("does not overwrite populated Spinosa targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spinosa-migration-"))
    const legacy = fixturePaths(root, "legacy")
    const spinosa = fixturePaths(root, "spinosa")
    try {
      await fs.mkdir(legacy.data, { recursive: true })
      await fs.writeFile(path.join(legacy.data, "session.txt"), "legacy")
      await fs.mkdir(spinosa.data, { recursive: true })
      await fs.writeFile(path.join(spinosa.data, "session.txt"), "spinosa")

      const results = await migrateLegacyPaths({ legacy, spinosa })

      expect(results.find((result) => result.source === legacy.data)?.result).toBe("conflict")
      expect(await fs.readFile(path.join(spinosa.data, "session.txt"), "utf8")).toBe("spinosa")
      expect(await fs.readFile(path.join(legacy.data, "session.txt"), "utf8")).toBe("legacy")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
