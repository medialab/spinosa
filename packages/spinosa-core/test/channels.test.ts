import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  setReleaseChannel,
  setAutoUpgrade,
  readAutoUpgrade,
  spinosaBetaToggleChannel,
  spinosaReleaseChannel,
  spinosaConfigFile,
} from "../src/system/channels"

let testHome = ""

function resetTestHome() {
  if (testHome) rmSync(testHome, { recursive: true, force: true })
  testHome = mkdtempSync(path.join(tmpdir(), "spinosa-channels-"))
  mkdirSync(path.join(testHome, "metadata"), { recursive: true })
  process.env.SPINOSA_HOME = testHome
  delete process.env.SPINOSA_RELEASE_CHANNEL
  delete process.env.SPINOSA_METADATA_DIR
}

afterEach(() => {
  delete process.env.SPINOSA_HOME
  delete process.env.SPINOSA_RELEASE_CHANNEL
  delete process.env.SPINOSA_METADATA_DIR
  if (testHome) rmSync(testHome, { recursive: true, force: true })
  testHome = ""
})

describe("release channel config", () => {
  test("normalizes relative product home and metadata overrides", () => {
    resetTestHome()
    process.env.SPINOSA_HOME = "relative-spinosa"
    expect(spinosaConfigFile()).toBe(path.resolve("relative-spinosa", "metadata", "config.yaml"))
    process.env.SPINOSA_METADATA_DIR = "relative-metadata"
    expect(spinosaConfigFile()).toBe(path.resolve("relative-metadata", "config.yaml"))
  })

  test("uses beta toggle as canonical config key", async () => {
    resetTestHome()
    await setReleaseChannel("beta")
    const config = await Bun.file(path.join(testHome, "metadata", "config.yaml")).text()
    expect(config).toContain("beta: true")
    expect(config).not.toContain("release_channel:")
    expect(await spinosaReleaseChannel()).toBe("beta")
  })

  test("writes stable as beta false", async () => {
    resetTestHome()
    await setReleaseChannel("stable")
    const config = await Bun.file(path.join(testHome, "metadata", "config.yaml")).text()
    expect(config).toContain("beta: false")
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("falls back to legacy release_channel when beta is absent", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "release_channel: beta\n")
    expect(await spinosaReleaseChannel()).toBe("beta")
  })

  test("prefers beta toggle over legacy release_channel", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "beta: false\nrelease_channel: beta\n")
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("normalizes installer beta toggle values", () => {
    expect(spinosaBetaToggleChannel("true")).toBe("beta")
    expect(spinosaBetaToggleChannel("false")).toBe("stable")
    expect(spinosaBetaToggleChannel("1")).toBe("beta")
    expect(spinosaBetaToggleChannel("0")).toBe("stable")
  })

  test("an invalid beta toggle falls back to stable instead of throwing", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "beta: sometimes\n")
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("an invalid release_channel falls back to stable instead of throwing", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "release_channel: canary\n")
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("an invalid SPINOSA_RELEASE_CHANNEL falls back to stable", async () => {
    resetTestHome()
    process.env.SPINOSA_RELEASE_CHANNEL = "bleeding"
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("a corrupt config file falls back to stable instead of throwing", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "beta: true\nbeta: false\n")
    expect(await spinosaReleaseChannel()).toBe("stable")
  })

  test("a corrupt config file does not disable auto-upgrade checks", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "auto_upgrade: true\nauto_upgrade: no\n")
    expect(await readAutoUpgrade()).toBe(true)
  })
})

describe("auto_upgrade config", () => {
  test("missing auto_upgrade means enabled", async () => {
    resetTestHome()
    writeFileSync(path.join(testHome, "metadata", "config.yaml"), "beta: true\n")
    expect(await readAutoUpgrade()).toBe(true)
  })

  test("auto_upgrade false disables", async () => {
    resetTestHome()
    await setAutoUpgrade(false)
    const config = await Bun.file(path.join(testHome, "metadata", "config.yaml")).text()
    expect(config).toContain("auto_upgrade: false")
    expect(await readAutoUpgrade()).toBe(false)
  })

  test("setAutoUpgrade true writes enabled", async () => {
    resetTestHome()
    await setAutoUpgrade(false)
    await setAutoUpgrade(true)
    expect(await readAutoUpgrade()).toBe(true)
  })
})
