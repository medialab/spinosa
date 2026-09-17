import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  cleanupStaleInstallDirectories,
  inspectSpinosaMaintenance,
  MIN_STALE_INSTALL_AGE_MS,
  MIN_STALE_TEMP_AGE_MS,
} from "@spinosa/core/system/maintenance"

test("maintenance inspection finds only abandoned installer directories", async () => {
  await using tmp = await tmpdir()
  const versions = path.join(tmp.path, "versions")
  const stale = path.join(versions, ".0.9.0.staging.999999")
  const fresh = path.join(versions, ".0.9.0.backup.999998")
  const release = path.join(versions, "0.9.0")
  await mkdir(path.join(stale, "node_modules"), { recursive: true })
  await mkdir(fresh, { recursive: true })
  await mkdir(release, { recursive: true })
  const old = new Date(Date.now() - MIN_STALE_INSTALL_AGE_MS - 1)
  await utimes(stale, old, old)

  const status = await inspectSpinosaMaintenance({ home: tmp.path, frameworkRoot: release, tempRoots: [] })
  expect(status.staleInstallDirectories).toEqual([stale])
  expect(status.staleNodeModulesDirectories).toBe(1)
  expect(status.dependencyRepairRequired).toBe(true)
  expect(status.dormantVersionDirectories).toEqual([release])

  const result = await cleanupStaleInstallDirectories({ home: tmp.path, frameworkRoot: release, tempRoots: [] })
  expect(result.removedDirectories).toEqual([stale])
  expect(existsSync(stale)).toBe(false)
  expect(existsSync(fresh)).toBe(true)
  expect(existsSync(release)).toBe(true)
})

test("maintenance inspection does not clean while a staging install lock is active", async () => {
  await using tmp = await tmpdir()
  const versions = path.join(tmp.path, "versions")
  const stale = path.join(versions, ".0.9.0.staging.999999")
  await mkdir(stale, { recursive: true })
  await mkdir(path.join(tmp.path, ".staging", ".install.lock"), { recursive: true })
  const old = new Date(Date.now() - MIN_STALE_INSTALL_AGE_MS - 1)
  await utimes(stale, old, old)

  const result = await cleanupStaleInstallDirectories({ home: tmp.path, tempRoots: [] })
  expect(result.installInProgress).toBe(true)
  expect(result.removedDirectories).toEqual([])
  expect(existsSync(stale)).toBe(true)
})

test("maintenance inspection does not clean while a legacy versions install lock is active", async () => {
  await using tmp = await tmpdir()
  const versions = path.join(tmp.path, "versions")
  const stale = path.join(versions, ".0.9.0.staging.999999")
  await mkdir(stale, { recursive: true })
  await mkdir(path.join(versions, ".install.lock"), { recursive: true })
  const old = new Date(Date.now() - MIN_STALE_INSTALL_AGE_MS - 1)
  await utimes(stale, old, old)

  const result = await cleanupStaleInstallDirectories({ home: tmp.path, tempRoots: [] })
  expect(result.installInProgress).toBe(true)
  expect(result.removedDirectories).toEqual([])
  expect(existsSync(stale)).toBe(true)
})

test("maintenance cleans stale OS temp dirs and failed template extracts", async () => {
  await using tmp = await tmpdir()
  const tempRoot = path.join(tmp.path, "os-tmp")
  const templates = path.join(tmp.path, "templates")
  await mkdir(tempRoot, { recursive: true })
  await mkdir(templates, { recursive: true })

  const launch = path.join(tempRoot, "spinosa-launch-dead")
  const upgrade = path.join(tempRoot, "spinosa-upgrade-dead")
  const extracting = path.join(templates, "1.0.3-beta.11-abc.extracting-999999-1")
  const tess = path.join(tempRoot, "spinosa-tess-dead")
  const vision = path.join(tempRoot, "spinosa-vision-pdf-dead")
  const backup = path.join(tempRoot, "spinosa-update-backup-1-dead")
  const payload = path.join(tempRoot, "spinosa-worker-payload-1-2-abc.json")
  const freshLaunch = path.join(tempRoot, "spinosa-launch-fresh")
  const keepUnrelated = path.join(tempRoot, "not-spinosa")

  for (const dir of [launch, upgrade, extracting, tess, vision, backup, freshLaunch, keepUnrelated]) {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "marker"), "x")
  }
  await writeFile(payload, "{}")
  const dead = [launch, upgrade, extracting, tess, vision, backup, payload]

  const old = new Date(Date.now() - MIN_STALE_TEMP_AGE_MS - 1)
  for (const dir of dead) await utimes(dir, old, old)

  const status = await inspectSpinosaMaintenance({
    home: tmp.path,
    tempRoots: [tempRoot],
  })
  expect(status.staleTempDirectories.sort()).toEqual(dead.sort())

  const result = await cleanupStaleInstallDirectories({
    home: tmp.path,
    tempRoots: [tempRoot],
  })
  expect(result.removedDirectories.sort()).toEqual(dead.sort())
  for (const dir of dead) expect(existsSync(dir)).toBe(false)
  expect(existsSync(freshLaunch)).toBe(true)
  expect(existsSync(keepUnrelated)).toBe(true)
})
