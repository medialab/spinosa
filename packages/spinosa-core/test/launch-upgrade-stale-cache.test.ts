import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { delay, http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { checkUpgradeAvailable, readVersionCache } from "../src/commands/upgrade"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const ENV_KEYS = [
  "SPINOSA_METADATA_DIR",
  "SPINOSA_TEMPLATE_ROOT",
  "SPINOSA_RELEASE_CHANNEL",
  "SPINOSA_NO_UPGRADE_CHECK",
] as const

const savedEnv = new Map<string, string | undefined>()
let dirs: string[] = []
let stdinIsTTY: unknown

function setupHarness(installedVersion: string): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
  }
  const metadataDir = mkdtempSync(path.join(tmpdir(), "spinosa-meta-"))
  const frameworkRoot = mkdtempSync(path.join(tmpdir(), "spinosa-fw-"))
  dirs = [metadataDir, frameworkRoot]
  mkdirSync(path.join(frameworkRoot, ".spinosa"), { recursive: true })
  writeFileSync(path.join(frameworkRoot, ".spinosa", "workspace-files.tsv"), "")
  mkdirSync(path.join(frameworkRoot, "metadata"), { recursive: true })
  writeFileSync(path.join(frameworkRoot, "metadata", "version"), `${installedVersion}\n`)
  process.env.SPINOSA_METADATA_DIR = metadataDir
  process.env.SPINOSA_TEMPLATE_ROOT = frameworkRoot
  process.env.SPINOSA_RELEASE_CHANNEL = "beta"
  delete process.env.SPINOSA_NO_UPGRADE_CHECK
  stdinIsTTY = (process.stdin as { isTTY?: unknown }).isTTY
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
  // Channel installer URLs are module-level constants, so mock the real hosts.
  server.use(
    http.get("https://github.com/medialab/spinosa/releases/download/beta/install.sh", () =>
      HttpResponse.text('#!/bin/sh\nPINNED_VERSION="1.2.2-beta.5"\n'),
    ),
    http.get("https://github.com/medialab/spinosa/releases/download/stable/install.sh", () =>
      HttpResponse.text('#!/bin/sh\nPINNED_VERSION="1.2.1"\n'),
    ),
  )
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key)
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  }
  savedEnv.clear()
  Object.defineProperty(process.stdin, "isTTY", { value: stdinIsTTY, configurable: true })
})

describe("checkUpgradeAvailable with a stale cache", () => {
  test("offers a just-released beta on the first launch, not the next one", async () => {
    setupHarness("1.2.2-beta.4")
    const cachePath = path.join(process.env.SPINOSA_METADATA_DIR!, "version_check_cache_beta")
    // Stale cache from before the release: old timestamp, old version.
    Bun.write(cachePath, "1700000000\n1.2.2-beta.4\n")

    const result = await checkUpgradeAvailable()

    expect(result.available).toBe(true)
    expect(result.latestVersion).toBe("1.2.2-beta.5")
    // The refresh landed before the decision, so the cache is fresh too.
    expect(readVersionCache("beta")?.version).toBe("1.2.2-beta.5")
  })

  test("fresh cache stays instant and offers the cached release", async () => {
    setupHarness("1.2.2-beta.4")
    const cachePath = path.join(process.env.SPINOSA_METADATA_DIR!, "version_check_cache_beta")
    const now = Math.floor(Date.now() / 1000)
    Bun.write(cachePath, `${now}\n1.2.2-beta.5\n`)

    const started = Date.now()
    const result = await checkUpgradeAvailable()

    expect(result.available).toBe(true)
    expect(result.latestVersion).toBe("1.2.2-beta.5")
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("stale cache with unreachable network fails open without an offer", async () => {
    setupHarness("1.2.2-beta.4")
    const cachePath = path.join(process.env.SPINOSA_METADATA_DIR!, "version_check_cache_beta")
    Bun.write(cachePath, "1700000000\n1.2.2-beta.4\n")
    server.use(
      http.get("https://github.com/medialab/spinosa/releases/download/beta/install.sh", async () => {
        await delay(5_000)
        return HttpResponse.text('#!/bin/sh\nPINNED_VERSION="9.9.9"\n')
      }),
    )

    const result = await checkUpgradeAvailable()

    expect(result.available).toBe(false)
  }, 15_000)
})
